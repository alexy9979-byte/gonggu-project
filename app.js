import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import path from 'path';
import cors from 'cors';
import nodemailer from 'nodemailer'; // 🌟 실제 이메일 발송 라이브러리 로드

// (생략된 기존 상단 설정 코드는 그대로 유지)

let emailVerificationDB = {}; // 인증번호 임시 보관소 { 이메일: 인증번호 }
let usersDB = []; 

// ==========================================
// 📧 [실제 구현] Google SMTP 기반 진짜 메일 우체부 설정
// ==========================================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // TLS 보안 프로토콜 사용
  auth: {
    user: 'alexy9979@gmail.com', // 👈 1. 본인의 진짜 Gmail 주소를 적으세요
    pass: 'zgkxsoofmvhlugnf' // 👈 2. 아까 구글에서 발급받은 16자리 앱 비밀번호를 띄어쓰기 없이 적으세요
  }
});


// 1. [API] 진짜 이메일로 6자리 인증번호 발송하기
app.post('/api/auth/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: '이메일을 입력해주세요.' });

  // 6자리 무작위 인증번호 생성
  const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
  emailVerificationDB[email] = verificationCode;

  // 💌 전송할 이메일의 디자인과 내용 레이아웃 설정
  const mailOptions = {
    from: `"공구메이트 운영팀" <alexy9979@gmail.com>`, // 보내는 사람
    to: email, // 받는 사람 (유저가 입력한 이메일)
    subject: '🛒 [공구메이트] 회원가입 이메일 인증번호입니다.', // 메일 제목
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; rounded: 8px;">
        <h2 style="color: #0d6efd; text-align: center;">🛒 공구메이트 회원가입</h2>
        <p style="font-size: 16px; color: #333;">안녕하세요! 우리 동네 실시간 공동구매 플랫폼 공구메이트입니다.</p>
        <p style="font-size: 14px; color: #666;">회원가입 화면에서 아래의 6자리 인증번호를 입력해 이메일 인증을 완료해주세요.</p>
        <div style="background-color: #f8f9fa; padding: 15px; text-align: center; border-radius: 5px; margin: 20px 0;">
          <span style="font-size: 28px; font-weight: bold; color: #333; letter-spacing: 5px;">${verificationCode}</span>
        </div>
        <p style="font-size: 12px; color: #999; text-align: center;">본 인증번호는 5분간 유효합니다.</p>
      </div>
    `
  };

  try {
    // 🚀 구글 서버를 통해 실제 유저에게 이메일 발송 실행!
    await transporter.sendMail(mailOptions);
    console.log(`[진짜 메일 발송 성공] To: ${email} | Code: ${verificationCode}`);
    
    res.status(200).json({ message: '📧 입력하신 메일함으로 진짜 인증번호가 발송되었습니다! 메일함을 확인해주세요.' });
  } catch (error) {
    console.error('메일 발송 최종 실패:', error);
    res.status(500).json({ message: '❌ 메일 발송 중 서버 내부 오류가 발생했습니다.', error: error.message });
  }
});


// 2. [API] 유저가 메일함 보고 입력한 번호 검증하기
app.post('/api/auth/verify-code', (req, res) => {
  const { email, code } = req.body;
  
  if (emailVerificationDB[email] && emailVerificationDB[email] === code) {
    delete emailVerificationDB[email]; // 인증 완료 시 파기
    return res.status(200).json({ message: '✅ 이메일 인증이 완벽하게 성공했습니다!' });
  }
  res.status(400).json({ message: '❌ 인증번호가 올바르지 않습니다. 다시 확인해주세요.' });
});

// (이하 로그인 및 공동구매 비즈니스 로직 코드는 그대로 유지)