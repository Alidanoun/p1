const request = require('supertest');
const app = require('../../src/server');

describe('🛡️ Uploads Route Security Tests', () => {
  beforeAll(async () => {
    // Wait for the async startServer() to fully register middlewares and routes
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  it('should block non-image sensitive files with 403 Forbidden', async () => {
    const res = await request(app).get('/uploads/.env');
    expect(res.status).toBe(403);
  });

  it('should block non-image arbitrary files with 403 Forbidden', async () => {
    const res = await request(app).get('/uploads/backup.sql');
    expect(res.status).toBe(403);
  });

  it('should allow valid image extensions (getting 404 instead of 403)', async () => {
    const res1 = await request(app).get('/uploads/test.webp');
    expect(res1.status).toBe(404);

    const res2 = await request(app).get('/uploads/test.png');
    expect(res2.status).toBe(404);

    const res3 = await request(app).get('/uploads/test.jpg');
    expect(res3.status).toBe(404);

    const res4 = await request(app).get('/uploads/test.jpeg');
    expect(res4.status).toBe(404);
  });
});
