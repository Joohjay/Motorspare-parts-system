import type {
  LoginResponse,
  MeResponse,
  MessageResponse,
  SafeUser,
} from '@/types/api';

import { apiRequest } from '@/lib/api';

export const authApi = {
  me(): Promise<MeResponse> {
    return apiRequest<MeResponse>('/auth/me');
  },

  login(email: string, password: string): Promise<LoginResponse> {
    return apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  logout(): Promise<void> {
    return apiRequest<void>('/auth/logout', { method: 'POST' });
  },

  forgotPassword(email: string): Promise<MessageResponse> {
    return apiRequest<MessageResponse>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  resetPassword(token: string, password: string): Promise<MessageResponse> {
    return apiRequest<MessageResponse>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  },

  setAccountStatus(userId: string, status: SafeUser['status']): Promise<{ user: SafeUser }> {
    return apiRequest<{ user: SafeUser }>(`/auth/users/${userId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },
};