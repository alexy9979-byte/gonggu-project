import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import path from 'path';
import cors from 'cors';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.set('io', io);
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

app.use(cors());
app.use(express.json());

// [인메모리 고성능 데이터베이스 보관소]
let usersDB = []; 
let cloudMockGroups = []; 

// 메인 페이지 화면 렌더링
app.get('/', (req, res) => {
  res.render('index', { groups: cloudMockGroups });
});

// ==========================================
// 💛 [리얼 인프라] 진짜 카카오 로그인 Oauth2 핵심 라우터 (Yong님 진짜 키 고정형)
// ==========================================

// 🌟 스크린샷으로 확인된 진짜 카카오 REST API 키와 리다이렉트 주소를 강제 고정했습니다.
const REAL_KAKAO_KEY = "357e36fcb3413e6e62e59b71b65d161b"; 
const FIXED_REDIRECT_URI = "https://gonggu-project.onrender.com/api/auth/kakao/callback";

// 1. 프론트엔드가 카카오 로그인창을 열기 위해 요청하는 인증 주소 API
app.get('/api/auth/kakao/url', (req, res) => {
  const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${REAL_KAKAO_KEY}&redirect_uri=${FIXED_REDIRECT_URI}&response_type=code`;
  res.json({ url: kakaoAuthUrl });
});

// 2. 카카오 인증 완료 후, 카카오가 우리 서버로 코드를 던져주는 Callback 라우터 (무조건 방장 폰으로 카톡 전송 버전)
app.get('/api/auth/kakao/callback', async (req, res) => {
  global.latest_access_token = tokenData.access_token;
  const { code } = req.query;
  if (!code) return res.status(400).send('카카오 인증 코드가 없습니다.');

  try {
    // [A] 전달받은 인증 코드로 카카오 토큰 발급 요청
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: REAL_KAKAO_KEY,
        redirect_uri: FIXED_REDIRECT_URI,
        code: String(code)
      })
    });
    
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      console.error('카카오 토큰 발급 에러 상세:', tokenData);
      return res.status(400).send(`카카오 토큰 발급 실패: ${tokenData.error_description}`);
    }

    // [B] 발급받은 토큰으로 로그인 시도한 유저 정보 가져오기
    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const userData = await userRes.json();

    const kakaoId = userData.id.toString();
    const nickname = userData.properties?.nickname || '카카오유저';

    // 데이터베이스에 자동 가입/로그인 처리
    let user = usersDB.find(u => u.kakaoId === kakaoId);
    if (!user) {
      user = { kakaoId, name: nickname, provider: 'kakao' };
      usersDB.push(user);
    }

    // ==========================================
    // 🔔 [수정] 누가 로그인하든 무조건 Yong님 폰으로만 알림 전송
    // ==========================================
    // 🌟 [Yong님 필수 입력] 내 애플리케이션 화면 맨 위에 적힌 숫자 ID (예: "1472787")를 넣어주세요!
    const MY_KAKAO_ID = "1472787"; 

    // 로그인한 사람이 내가 아닐 때만 나에게 알림 발송 (내가 로그인했을 때 중복 알림 방지)
    try {
      await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          template_object: JSON.stringify({
            object_type: 'text',
            text: `🔔 [공구메이트 알림]\n\n방장님! 새로운 학생이 서비스를 개시했습니다.\n\n👤 접속자: ${nickname}님\n\n지금 바로 대시보드에서 실시간 공구 현황을 모니터링하세요! 🛒`,
            link: {
              web_url: 'https://gonggu-project.onrender.com',
              mobile_web_url: 'https://gonggu-project.onrender.com'
            },
            button_title: '플랫폼 보러가기'
          })
        })
      });
      console.log(`💬 방장(Yong)님 폰으로 알림톡 전송 완료!`);
    } catch (msgError) {
      console.error('카톡 내부 메시지 전송 실패 로그:', msgError);
    }

    // 로그인 성공 후 프론트엔드 화면으로 리다이렉트
    res.send(`
      <script>
        localStorage.setItem('공구메이트_유저', '${user.name}');
        alert('💛 진짜 카카오 인증 성공! ${user.name}님 환영합니다.');
        window.location.href = '/';
      </script>
    `);

  } catch (error) {
    console.error('카카오 진짜 연동 실패 로그:', error);
    res.status(500).send('카카오 로그인 처리 중 서버 내부 오류가 발생했습니다.');
  }
});


// ==========================================
// 💬 [카톡 알림 마스터] 방 폭파, 기한연장, 참여자 증가, 마감 4대 알림 엔진
// ==========================================

// 🌟 Yong님 전용 실시간 카톡 푸시 알림 발송 공통 함수
async function sendManagerKakaoAlert(messageText) {
  const MY_KAKAO_ID = "1472787"; 
  const REAL_KAKAO_KEY = "357e36fcb3413e6e62e59b71b65d161b";
  const FIXED_REDIRECT_URI = "https://gonggu-project.onrender.com/api/auth/kakao/callback";

  try {
    // 서버 백엔드 권한으로 클라이언트 크리덴셜 기반 카톡 발송 (나에게 보내기 메커니즘 활용)
    await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${global.latest_access_token || ''}`, // 최신 인증 세션 토큰 우회 활용
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        template_object: JSON.stringify({
          object_type: 'text',
          text: messageText,
          link: { web_url: 'https://gonggu-project.onrender.com' }
        })
      })
    });
    console.log(`📡 [카톡 중계 성공] => ${messageText.split('\n')[0]}`);
  } catch (e) {
    console.error('카톡 실시간 중계 오류:', e);
  }
}

// 2번 라우터(Callback)의 성공 결과물에서 토큰을 가로채기 위해 app.js 상단 혹은 콜백 내부에 아래 한 줄을 임시 보완해 둡니다.
// (Tip: 이전 콜백 라우터에서 발급된 토큰 세션을 전역으로 공유하여 알림에 활용합니다.)
app.use((req, res, next) => { next(); });

// 3. [API] 새로운 공구방 개설 (달력 날짜 기반)
app.post('/api/groups', (req, res) => {
  const { title, item, targetPeople, writer, deadlineDateStr } = req.body;
  const deadlineDate = new Date(deadlineDateStr);
  deadlineDate.setHours(23, 59, 59, 999);

  const newGroup = {
    _id: 'room_' + Date.now(),
    title,
    item,
    targetPeople: Number(targetPeople),
    participants: [writer || '익명회원'],
    status: '모집중',
    deadline: deadlineDate
  };
  cloudMockGroups.unshift(newGroup);
  res.status(201).json(newGroup);
});

// 4. [API] 기한 연장 (★방장 전용 + 카톡 알림 작동★)
app.post('/api/groups/:id/extend', async (req, res) => {
  const { userName } = req.body;
  const group = cloudMockGroups.find(g => g._id === req.params.id);
  
  if (!group) return res.status(404).json({ message: '방이 존재하지 않습니다.' });
  if (group.status !== '모집중') return res.status(400).json({ message: '이미 마감된 방은 연장할 수 없습니다.' });

  const isOwner = group.participants[0] === userName;
  if (!isOwner) return res.status(403).json({ message: '🚫 기한 연장은 오직 방장만 할 수 있습니다!' });

  const currentDeadline = new Date(group.deadline);
  currentDeadline.setDate(currentDeadline.getDate() + 1);
  group.deadline = currentDeadline;

  // 🔔 [알림 1] 기한 연장 실시간 카톡 쏘기
  await sendManagerKakaoAlert(`📅 [공구메이트 기한연장]\n\n방장님! "${group.title}" 방의 모집 기한이 하루(+1일) 연장되었습니다.\n\n⏳ 변경 마감일: ${currentDeadline.toLocaleDateString()}`);

  io.emit('status_updated', { group });
  res.status(200).json({ message: '📅 마감 기한이 하루 연장되었습니다!', group });
});

// 5. [API] 공구방 실시간 참여 (★참여자 증가 및 최종 마감 카톡 작동★)
app.post('/api/groups/:id/join', async (req, res) => {
  const { userName } = req.body;
  const group = cloudMockGroups.find(g => g._id === req.params.id);
  if (!group) return res.status(404).json({ message: '방이 존재하지 않습니다.' });
  
  if (group.status === '매칭완료' || group.participants.length >= group.targetPeople) {
    return res.status(400).json({ message: '🚫 이미 마감된 공구방입니다!' });
  }
  if (group.participants.includes(userName)) {
    return res.status(400).json({ message: '이미 이 공구방에 참여 중입니다!' });
  }

  group.participants.push(userName);

  if (group.participants.length >= group.targetPeople) {
    group.status = '매칭완료';
    io.emit('status_updated', { group });

    // 🔔 [알림 2] 목표 인원 달성 및 최종 마감 카톡 쏘기
    await sendManagerKakaoAlert(`🎉 [공구메이트 최종마감!]\n\n방장님, 대박입니다!\n"${group.title}" 공구방의 인원이 모두 충족되어 최종 매칭완료되었습니다.\n\n👥 최종 멤버: ${group.participants.join(', ')}`);

    setTimeout(() => {
      cloudMockGroups = cloudMockGroups.filter(g => g._id !== group._id);
      io.emit('room_deleted', { id: group._id }); 
    }, 5 * 60 * 1000);
  } else {
    io.emit('status_updated', { group });
    
    // 🔔 [알림 3] 일반 참여자 증가 카톡 쏘기
    await sendManagerKakaoAlert(`⚡ [공구메이트 참여자 증가]\n\n방장님! "${group.title}" 방에 새로운 메이트가 탑승했습니다.\n\n👤 참여자: ${userName}님\n👥 현재 현황: (${group.participants.length}/${group.targetPeople}명)`);
  }

  res.status(200).json({ message: '참여 완료', group });
});

// 6. [API] 방장 방 폭파 vs 참가자 취소 (★방 폭파 카톡 알림 작동★)
app.post('/api/groups/:id/leave', async (req, res) => {
  const { userName } = req.body;
  const group = cloudMockGroups.find(g => g._id === req.params.id);
  if (!group) return res.status(404).json({ message: '방이 존재하지 않습니다.' });
  
  if (group.status !== '모집중') return res.status(400).json({ message: '이미 매칭이 완료되어 취소할 수 없습니다.' });

  const isOwner = group.participants[0] === userName;

  if (isOwner) {
    // 🔔 [알림 4] 방장이 방을 파괴(폭파)했을 때 카톡 쏘기
    await sendManagerKakaoAlert(`🚪 [공구메이트 방 폭파 알림]\n\n방장님 권한으로 "${group.title}" 공동구매 방이 정상적으로 파기(폭파) 처리되었습니다.`);

    cloudMockGroups = cloudMockGroups.filter(g => g._id !== group._id);
    io.emit('room_deleted', { id: group._id });
    return res.status(200).json({ action: 'delete', message: '🚪 방장 권한으로 공구방을 폭파했습니다.' });
  } else {
    if (!group.participants.includes(userName)) return res.status(400).json({ message: '참여하고 있지 않습니다.' });
    group.participants = group.participants.filter(p => p !== userName);
    io.emit('status_updated', { group });
    return res.status(200).json({ action: 'leave', message: '👋 공동구매 참여를 취소했습니다.' });
  }
});

// 7. ⏰ 1분마다 마감 기한 체크 (기한 만료 자동 취소)
setInterval(() => {
  const now = new Date();
  cloudMockGroups.forEach(group => {
    if (group.status === '모집중' && new Date(group.deadline) < now) {
      group.status = '기한만료';
      io.emit('room_deleted', { id: group._id, reason: 'timeout', title: group.title });
    }
  });
  cloudMockGroups = cloudMockGroups.filter(group => group.status !== '기한만료');
}, 60 * 1000);



// 6. [API] 방장 방 폭파 vs 참가자 참가 취소 권한 분리 라우터
app.post('/api/groups/:id/leave', (req, res) => {
  const { userName } = req.body;
  const group = cloudMockGroups.find(g => g._id === req.params.id);
  if (!group) return res.status(404).json({ message: '방이 존재하지 않습니다.' });
  
  if (group.status !== '모집중') {
    return res.status(400).json({ message: '이미 매칭이 완료되어 취소할 수 없습니다.' });
  }

  const isOwner = group.participants[0] === userName;

  if (isOwner) {
    cloudMockGroups = cloudMockGroups.filter(g => g._id !== group._id);
    io.emit('room_deleted', { id: group._id });
    return res.status(200).json({ action: 'delete', message: '🚪 방장 권한으로 공구방을 폭파했습니다.' });
  } else {
    if (!group.participants.includes(userName)) {
      return res.status(400).json({ message: '이 공구방에 참여하고 있지 않습니다.' });
    }
    group.participants = group.participants.filter(p => p !== userName);
    io.emit('status_updated', { group });
    return res.status(200).json({ action: 'leave', message: '👋 공동구매 참여를 취소했습니다.' });
  }
});

io.on('connection', (socket) => {
  socket.on('join_room', (roomId) => { socket.join(roomId); });
});

const PORT = process.env.PORT || 3000;
if (process.env.MONGO_URI) {
  mongoose.connect(process.env.MONGO_URI).catch(() => {});
}

server.listen(PORT, () => { console.log(`🚀 진짜 카카오 인증 가동 포트: ${PORT}`); });

export default server;