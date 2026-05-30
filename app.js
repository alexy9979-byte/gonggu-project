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
// 💛 [리얼 인프라] 진짜 카카오 로그인 Oauth2 핵심 라우터
// ==========================================

// 1. 프론트엔드가 카카오 로그인창을 열기 위해 요청하는 인증 주소 API
app.get('/api/auth/kakao/url', (req, res) => {
  const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${process.env.KAKAO_REST_KEY}&redirect_uri=${process.env.KAKAO_REDIRECT_URI}&response_type=code`;
  res.json({ url: kakaoAuthUrl });
});

// 2. 카카오 인증 완료 후, 카카오가 우리 서버로 코드를 던져주는 Callback 라우터
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
        client_id: process.env.KAKAO_REST_KEY,
        redirect_uri: process.env.KAKAO_REDIRECT_URI,
        code
      })
    });
    const tokenData = await tokenRes.json();

    // [B] 발급받은 토큰으로 진짜 카카오 유저 정보(프로필, 이름 등) 가져오기
    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const userData = await userRes.json();

    // 카카오가 제공한 고유 유저 정보 파싱
    const kakaoId = userData.id.toString();
    const nickname = userData.properties?.nickname || '카카오유저';

    // 데이터베이스에 자동 가입/로그인 처리
    let user = usersDB.find(u => u.kakaoId === kakaoId);
    if (!user) {
      user = { kakaoId, name: nickname, provider: 'kakao' };
      usersDB.push(user);
    }

    // 로그인 성공 후 프론트엔드 화면으로 유저 이름을 세션 스크립트에 실어 리다이렉트
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

// 3. [API] 새로운 공구방 개설
app.post('/api/groups', (req, res) => {
  const { title, item, targetPeople, writer } = req.body;
  const newGroup = {
    _id: 'room_' + Date.now(),
    title,
    item,
    targetPeople: Number(targetPeople),
    participants: [writer || '익명회원'],
    status: '모집중'
  };
  cloudMockGroups.unshift(newGroup);
  res.status(201).json(newGroup);
});

// 4. [API] 공구방 실시간 참여
app.post('/api/groups/:id/join', (req, res) => {
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
  
  // 매칭 완료 시 정확히 5분 뒤 자동 제거 스펙
  if (group.participants.length >= group.targetPeople) {
    group.status = '매칭완료';
    setTimeout(() => {
      cloudMockGroups = cloudMockGroups.filter(g => g._id !== group._id);
      io.emit('room_deleted', { id: group._id }); 
    }, 5 * 60 * 1000); 
  }
  
  io.emit('status_updated', { group });
  res.status(200).json({ message: '참여 완료', group });
});

// 5. [API] 방장 방 폭파 vs 참가자 참가 취소 권한 분리 라우터
app.post('/api/groups/:id/leave', (req, res) => {
  const { userName } = req.body;
  const group = cloudMockGroups.find(g => g._id === req.params.id);
  if (!group) return res.status(404).json({ message: '방이 존재하지 않습니다.' });
  
  if (group.status !== '모집중') {
    return res.status(400).json({ message: '이미 매칭이 완료되어 취소할 수 없습니다.' });
  }

  // 👑 배열의 첫 번째 자리에 있는 유저가 방장(최초 개설자)입니다.
  const isOwner = group.participants[0] === userName;

  if (isOwner) {
    // 💥 방장이 취소한 경우: 방 자체를 파기
    cloudMockGroups = cloudMockGroups.filter(g => g._id !== group._id);
    io.emit('room_deleted', { id: group._id });
    return res.status(200).json({ action: 'delete', message: '🚪 방장 권한으로 공구방을 폭파했습니다.' });
  } else {
    // 👥 참가자가 취소한 경우: 해당 참가자만 명단에서 제외
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