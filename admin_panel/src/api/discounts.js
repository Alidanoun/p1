import { api } from './client';

export const discountApi = {
  getCampaigns: async () => {
    const res = await api.get('/discounts/campaigns');
    return res.data;
  },
  
  createCampaign: async (data) => {
    const res = await api.post('/discounts/campaigns', data);
    return res.data;
  },
  
  toggleCampaignStatus: async (id, isActive) => {
    const res = await api.patch(`/discounts/campaigns/${id}/status`, { isActive });
    return res.data;
  },
  
  deleteCampaign: async (id) => {
    const res = await api.delete(`/discounts/campaigns/${id}`);
    return res.data;
  }
};
