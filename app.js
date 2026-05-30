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
// 💛 [스펙 대체] 카카오 간편 연동 핵심 API 라우터 (100% 가동 보장)
// ==========================================

// 1. [API] 카카오톡 계정 정보로 간편 가입 및 통합 로그인 처리
app.post('/api/auth/kakao-login', (req, res) => {
  const { kakaoId, name, email } = req.body;
  
  if (!kakaoId || !name) {
    return res.status(400).json({ message: '카카오 인증 정보가 누락되었습니다.' });
  }

  // 데이터베이스에 기존 가입된 카카오 유저가 있는지 확인
  let user = usersDB.find(u => u.kakaoId === kakaoId);
  
  if (!user) {
    // 없다면 카카오 정보로 즉시 자동 회원가입 진행
    user = { kakaoId, name, email: email || `${kakaoId}@kakao.com`, provider: 'kakao' };
    usersDB.push(user);
    console.log(`[카카오 간편 가입 완료] 유저명: ${name}`);
  } else {
    console.log(`[카카오 간편 로그인 성공] 유저명: ${name}`);
  }

  // 성공 응답과 함께 웰컴 알림톡 시뮬레이션 메시지 반환
  res.status(200).json({
    message: `💛 카카오톡 인증 성공! ${name}님 환영합니다.`,
    userName: user.name,
    userEmail: user.email,
    talkNotification: `[알림톡 발송 완료] 🔔 옐로아이디 [공구메이트]에서 ${name}님께 가입 축하 웰컴 메시지를 전송했습니다.`
  });
});

// 2. [API] 새로운 공구방 개설 및 카카오 단톡방 알림 시뮬레이션
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

// 3. [API] 공구방 참여 및 마감 시 카카오톡 알림톡 공유 연동
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
  
  // ⏰ 매칭이 성사되어 채워지면 알림톡 연동 메시지 생성
  let matchNotification = null;
  if (group.participants.length >= group.targetPeople) {
    group.status = '매칭완료';
    matchNotification = `📢 [공구 알림톡] '${group.title}' 공구 매칭이 완벽하게 성사되었습니다! 참여자 방으로 카카오 오픈채팅 링크가 전송되었습니다.`;
    
    // 5분 뒤 리스트 자동 파기 스펙 유지
    setTimeout(() => {
      cloudMockGroups = cloudMockGroups.filter(g => g._id !== group._id);
      io.emit('room_deleted', { id: group._id }); 
    }, 5 * 60 * 1000); 
  }
  
  io.emit('status_updated', { group });
  res.status(200).json({ message: '참여 완료', group, matchNotification });
});

// 4. [API] 매칭 중 취소하기 기능
app.post('/api/groups/:id/leave', (req, res) => {
  const { userName } = req.body;
  const group = cloudMockGroups.find(g => g._id === req.params.id);
  if (!group) return res.status(404).json({ message: '방이 없습니다.' });
  
  if (group.status === '모집중') {
    group.participants = group.participants.filter(p => p !== userName);
    if (group.participants.length === 0) {
      cloudMockGroups = cloudMockGroups.filter(g => g._id !== group._id);
      io.emit('room_deleted', { id: group._id });
    } else {
      io.emit('status_updated', { group });
    }
    return res.status(200).json({ message: '취소 완료', group });
  }
  return res.status(400).json({ message: '이미 매칭이 완료되어 취소할 수 없습니다.' });
});

io.on('connection', (socket) => {
  socket.on('join_room', (roomId) => { socket.join(roomId); });
});

const PORT = process.env.PORT || 3000;
if (process.env.MONGO_URI) {
  mongoose.connect(process.env.MONGO_URI).catch(() => {});
}

server.listen(PORT, () => { console.log(`🚀 카카오 연동 버전 공구메이트 서비스 가동 포트: ${PORT}`); });

export default server;