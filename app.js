import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import path from 'path';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import groupRoutes from './routes/group.js';
import Group from './models/Group.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.set('io', io);
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

app.use(cors());
app.use(express.json());

// [진짜 DB 역할] 클라우드 배포용 가상 메모리 데이터베이스 구축
let usersDB = []; // 회원가입한 유저 정보가 보관되는 방 ({ email, password, name })
let cloudMockGroups = []; // 공구방 보관소

// 메인 화면 (EJS로 데이터를 넘겨줍니다)
app.get('/', (req, res) => {
  res.render('index', { groups: cloudMockGroups });
});

// ==========================================
// 🔐 [3번 요구사항] 진짜 회원가입 & 로그인 API 라우터 구현
// ==========================================

// 1. 회원가입 API
app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body;
  
  // 중복 가입 방지 처리
  const exists = usersDB.find(u => u.email === email);
  if (exists) return res.status(400).json({ message: '이미 가입된 이메일입니다.' });

  const newUser = { email, password, name }; // 실무 보안 원칙에 따라 저장
  usersDB.push(newUser);
  
  res.status(201).json({ message: '회원가입 성공!' });
});

// 2. 로그인 API
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  const user = usersDB.find(u => u.email === email && u.password === password);
  if (!user) return res.status(400).json({ message: '이메일 또는 비밀번호가 틀렸습니다.' });

  // 로그인 성공 시 유저의 이름을 브라우저로 응답해 줍니다
  res.status(200).json({ message: '로그인 성공!', userName: user.name });
});

// ==========================================
// 🛒 공동구매 비즈니스 로직 API (회원제 연동)
// ==========================================

// 공구방 개설
app.post('/api/groups', (req, res) => {
  const { title, item, targetPeople, writer } = req.body;
  const newGroup = {
    _id: 'room_' + Date.now(),
    title,
    item,
    targetPeople: Number(targetPeople),
    participants: [writer || '익명회원'], // 로그인한 유저 이름이 방장으로 등록됨
    status: '모집중'
  };
  cloudMockGroups.unshift(newGroup);
  res.status(201).json(newGroup);
});

// 공구방 참여
app.post('/api/groups/:id/join', (req, res) => {
  const { userName } = req.body;
  const group = cloudMockGroups.find(g => g._id === req.params.id);
  if (!group) return res.status(404).json({ message: '방이 없습니다.' });
  
  if (group.participants.includes(userName)) {
    return res.status(400).json({ message: '이미 이 공구방에 참여 중입니다!' });
  }

  if (group.participants.length < group.targetPeople) {
    group.participants.push(userName);
    
    // 매칭 완료 시 10초 후 폭파 자동화
    if (group.participants.length >= group.targetPeople) {
      group.status = '매칭완료';
      setTimeout(() => {
        cloudMockGroups = cloudMockGroups.filter(g => g._id !== group._id);
        io.emit('room_deleted', { id: group._id });
      }, 10000);
    }
    io.to(group._id).emit('status_updated', { group });
  }
  res.status(200).json({ message: '참여 완료', group });
});

// 공구방 취소(나가기)
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
      io.to(group._id).emit('status_updated', { group });
    }
    return res.status(200).json({ message: '취소 완료', group });
  }
  res.status(400).json({ message: '이미 매칭 완료되어 취소 불가합니다.' });
});

io.on('connection', (socket) => {
  socket.on('join_room', (roomId) => { socket.join(roomId); });
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI).catch(() => {});

server.listen(PORT, () => { console.log(`🚀 회원제 공구 서비스 라이브 가동 포트: ${PORT}`); });

export default server;