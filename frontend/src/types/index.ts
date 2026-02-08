export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string;
}

export interface Message {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  type: 'text' | 'image' | 'file' | 'voice';
  fileUrl?: string;
  fileName?: string;
}

export interface Conversation {
  id: string;
  title: string;
  lastMessage: string;
  updatedAt: Date;
  messageCount: number;
}
