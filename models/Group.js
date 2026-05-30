import mongoose from 'mongoose';

const groupSchema = new mongoose.Schema({
  title: { 
    type: String, 
    required: true 
  },
  item: { 
    type: String, 
    required: true 
  },
  targetPeople: { 
    type: Number, 
    required: true,
    min: [2, '공동구매는 최소 2명 이상이어야 합니다.']
  },
  // 참여한 유저들의 ID 목록을 배열로 담아 관리합니다 (10주차)
  participants: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  status: { 
    type: String, 
    enum: ['모집중', '매칭완료', '취소'], 
    default: '모집중' 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

export default mongoose.model('Group', groupSchema);