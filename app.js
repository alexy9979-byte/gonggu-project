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

// 전역 토큰 공유 저장소 선언
global.latest_access_token = ''; 

// 메인 페이지 화면 렌더링
app.get('/', (req, res) => {
  res.render('index', { groups: cloudMockGroups });
});

// ==========================================
// 💛 [인프라] 카카오 로그인 및 토큰 탈취 라우터
// ==========================================
const REAL_KAKAO_KEY = "357e36fcb3413e6e62e59b71b65d161b"; 
const FIXED_REDIRECT_URI = "https://gonggu-project.onrender.com/api/auth/kakao/callback";

app.get('/api/auth/kakao/url', (req, res) => {
  const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${REAL_KAKAO_KEY}&redirect_uri=${FIXED_REDIRECT_URI}&response_type=code`;
  res.json({ url: kakaoAuthUrl });
});

app.get('/api/auth/kakao/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('카카오 인증 코드가 없습니다.');

  try {
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
    if (tokenData.error) return res.status(400).send(`토큰 발급 실패: ${tokenData.error_description}`);

    // 🔥 알림 엔진이 가로챌 수 있도록 전역 공간에 토큰 주입
    global.latest_access_token = tokenData.access_token;

    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const userData = await userRes.json();
    const kakaoId = userData.id.toString();
    const nickname = userData.properties?.nickname || '카카오유저';

    let user = usersDB.find(u => u.kakaoId === kakaoId);
    if (!user) {
      user = { kakaoId, name: nickname, provider: 'kakao' };
      usersDB.push(user);
    }

    res.send(`
      <script>
        localStorage.setItem('공구메이트_유저', '${user.name}');
        alert('💛 진짜 카카오 인증 성공! ${user.name}님 환영합니다.');
        window.location.href = '/';
      </script>
    `);
  } catch (error) {
    res.status(500).send('카카오 로그인 처리 중 서버 내부 오류가 발생했습니다.');
  }
});

// ==========================================
// 💬 [카톡 알림 마스터] 4대 이벤트 메시지 발송 엔진
// ==========================================
async function sendManagerKakaoAlert(messageText) {
  try {
    await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${global.latest_access_token || ''}`,
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
    console.log(`📡 [카톡 중계 성공]`);
  } catch (e) {
    console.error('카톡 실시간 중계 오류:', e);
  }
}

// ==========================================
// 🛠️ 비즈니스 로직 (개설, 연장, 참여, 폭파, 타이머)
// ==========================================

// 3. 공구방 개설
app.post('/api/groups', (req, res) => {
  const { title, item, targetPeople, writer, deadlineDateStr, distDate, distLocation } = req.body;
  const deadlineDate = new Date(deadlineDateStr);
  deadlineDate.setHours(23, 59, 59, 999);

  const newGroup = {
    _id: 'room_' + Date.now(),
    title,
    item,
    targetPeople: Number(targetPeople),
    participants: [writer || '익명회원'],
    status: '모집중',
    deadline: deadlineDate,
    distDate,
    distLocation
  };
  cloudMockGroups.unshift(newGroup);
  res.status(201).json(newGroup);
});

// 4. 기한 연장 (방장 한정 + 카톡 연동)
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

  // 🔔 [알림 1] 기한 연장 쏘기
  await sendManagerKakaoAlert(`📅 [공구메이트 기한연장]\n\n방장님! "${group.title}" 방의 모집 기한이 하루(+1일) 연장되었습니다.\n\n⏳ 변경 마감일: ${currentDeadline.toLocaleDateString()}`);

  io.emit('status_updated', { group });
  res.status(200).json({ message: '📅 마감 기한이 하루 연장되었습니다!', group });
});

// 5. 실시간 참여 (참여자 증가 및 최종 마감 카톡 연동)
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

    // 🔔 [알림 2] 최종 마감 카톡 쏘기
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

// 6. 방 파기 취소 (방 폭파 카톡 연동)
app.post('/api/groups/:id/leave', async (req, res) => {
  const { userName } = req.body;
  const group = cloudMockGroups.find(g => g._id === req.params.id);
  if (!group) return res.status(404).json({ message: '방이 존재하지 않습니다.' });
  if (group.status !== '모집중') return res.status(400).json({ message: '이미 매칭이 완료되어 취소할 수 없습니다.' });

  const isOwner = group.participants[0] === userName;

  if (isOwner) {
    // 🔔 [알림 4] 방 폭파 카톡 쏘기
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

// 7. 1분마다 마감 기한 체크
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`🚀 시스템 정상 가동 포트: ${PORT}`); });

export default server;