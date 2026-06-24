import axios from 'axios';

const BASE = import.meta.env.VITE_API_BASE_URL || '';

const api = axios.create({ baseURL: BASE });

export const tasksApi = {
  list: ()                           => api.get('/api/tasks'),
  get:  (id: string)                 => api.get(`/api/tasks/${id}`),
  run:  (id: string, params = {})    => api.post(`/api/tasks/${id}/run`, { robot_params: params }),
  create: (data: object)             => api.post('/api/tasks', data),
  delete: (id: string)               => api.delete(`/api/tasks/${id}`),
};

export const executionsApi = {
  list:    (taskId?: string)         => api.get('/api/executions', { params: { task_id: taskId } }),
  get:     (id: string)              => api.get(`/api/executions/${id}`),
  getLogs: (id: string, afterId = 0) => api.get(`/api/executions/${id}/logs`, { params: { after_id: afterId } }),
};

export const schedulesApi = {
  list:   ()                         => api.get('/api/schedules'),
  create: (data: object)             => api.post('/api/schedules', data),
  toggle: (id: string)               => api.patch(`/api/schedules/${id}/toggle`),
  delete: (id: string)               => api.delete(`/api/schedules/${id}`),
};
