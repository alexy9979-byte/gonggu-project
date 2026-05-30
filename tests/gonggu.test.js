import request from 'supertest';
import mongoose from 'mongoose';
import server from '../app.js';
import dotenv from 'dotenv';

dotenv.config(); // .env 파일에 적은 진짜 클라우드 주소를 불러옵니다 (1주차)

describe('🛒 실시간 공동구매 API 자동화 통합 테스트 (12주차)', () => {
  
  // 테스트가 시작되기 전에 진짜 MongoDB Atlas 클라우드에 접속합니다 (10주차)
  beforeAll(async () => {
    const MONGO_URI = process.env.MONGO_URI;
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(MONGO_URI);
    }
  });

  // 모든 테스트가 끝나면 안전하게 클라우드 연결을 끊고 서버를 닫습니다 (12주차)
  afterAll(async () => {
    await mongoose.connection.close();
    server.close();
  });

  // 5주차 서버 통신 테스트
  it('GET / - 메인 페이지가 200 정상 신호를 반환해야 한다', async () => {
    const res = await request(server).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('실시간 공동구매 백엔드 서버');
  });

  // 10주차 진짜 MongoDB Atlas 데이터 조회 테스트
  it('GET /api/groups - 공구방 목록 조회 시 데이터베이스에서 성공적으로 리스트를 가져와야 한다', async () => {
    const res = await request(server).get('/api/groups');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});