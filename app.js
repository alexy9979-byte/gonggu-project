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
// 📅 [수정] 기한(날짜 단위) 및 연장 기능이 추가된 라우터 구역
// ==========================================

// 3. [API] 새로운 공구방 개설 (마감일 추가)
app.post('/api/groups', (req, res) => {
  const { title, item, targetPeople, writer, deadlineDays } = req.body;
  
  // 현재 시간 기준으로 사용자가 선택한 일(Day)만큼 마감일 계산
  const days = Number(deadlineDays) || 1;
  const deadlineDate = new Date();
  deadlineDate.setDate(deadlineDate.getDate() + days);
  deadlineDate.setHours(23, 59, 59, 999); // 해당 날짜의 밤 11시 59분 마감

  const newGroup = {
    _id: 'room_' + Date.now(),
    title,
    item,
    targetPeople: Number(targetPeople),
    participants: [writer || '익명회원'],
    status: '모집중',
    deadline: deadlineDate // 📅 마감일 저장
  };
  cloudMockGroups.unshift(newGroup);
  res.status(201).json(newGroup);
});

// 4. [새로 추가] 기한 연장 API (하루 단위 추가)
app.post('/api/groups/:id/extend', (req, res) => {
  const group = cloudMockGroups.find(g => g._id === req.params.id);
  if (!group) return res.status(404).json({ message: '방이 존재하지 않습니다.' });
  if (group.status !== '모집중') return res.status(400).json({ message: '이미 마감된 방은 연장할 수 없습니다.' });

  // 📅 기존 마감일에서 정확히 1일(하루) 연장
  const currentDeadline = new Date(group.deadline);
  currentDeadline.setDate(currentDeadline.getDate() + 1);
  group.deadline = currentDeadline;

  // 실시간으로 모든 학생에게 기한 연장 정보 전송
  const io = app.get('io');
  io.emit('status_updated', { group });

  res.status(200).json({ message: '📅 마감 기한이 하루 연장되었습니다!', group });
});

// 5. ⏰ [주기적 체크] 1분마다 마감 기한이 지난 방 자동 취소(폭파) 프로세스
setInterval(() => {
  const now = new Date();
  const io = app.get('io');

  cloudMockGroups.forEach(group => {
    if (group.status === '모집중' && new Date(group.deadline) < now) {
      group.status = '기한만료';
      // 실시간으로 방 파기 신호 발송
      io.emit('room_deleted', { id: group._id, reason: 'timeout', title: group.title });
    }
  });

  // 기한이 만료된 방은 데이터베이스 목록에서 완전히 제거
  cloudMockGroups = cloudMockGroups.filter(group => group.status !== '기한만료');
}, 60 * 1000); // 1분마다 검사


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