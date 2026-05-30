import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';

import authRoutes from './routes/auth.js';
import groupRoutes from './routes/group.js';
import Group from './models/Group.js'; // 화면에 공구 목록을 뿌려주기 위해 가져옴

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.set('io', io);

// [9주차 핵심] EJS 템플릿 엔진 세팅으로 가시적인 웹사이트 구현 설정
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);

// [5주차 + 9주차 SSR] 사용자가 인터넷 주소를 치고 들어왔을 때 진짜 공구 웹사이트 화면을 보여줍니다
app.get('/', async (req, res) => {
  try {
    // MongoDB Atlas에서 현재 모집 중인 공구방 데이터를 진짜로 긁어옵니다 (10주차)
    const groups = await Group.find().sort({ createdAt: -1 });
    
    // 9주차 res.render() 기술을 사용해 index.ejs 화면에 데이터를 주입하여 사이트를 통째로 그려서 보냅니다
    res.render('index', { groups: groups });
  } catch (err) {
    res.status(500).send('웹사이트 로딩 중 오류가 발생했습니다.');
  }
});

// [11주차 임시 조치] 프론트엔드 실시간 UI 테스트를 위해 미들웨어 검증을 통과시키는 가짜 토큰 발행 처리
app.use((req, res, next) => {
  if (req.headers.authorization === 'Bearer test-token') {
    req.user = { id: new mongoose.Types.ObjectId().toString() };
  }
  next();
});

io.on('connection', (socket) => {
  socket.on('join_room', (roomId) => {
    socket.join(roomId);
  });
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gonggu';

if (process.env.NODE_ENV !== 'test') {
  mongoose.connect(MONGO_URI)
    .then(() => {
      console.log('🌱 MongoDB Atlas 클라우드 데이터베이스 연결 성공!');
      server.listen(PORT, () => {
        console.log(`🚀 실제 웹사이트가 구동 중입니다! 주소: http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('❌ 데이터베이스 연결 실패:', err);
    });
}

export default server;