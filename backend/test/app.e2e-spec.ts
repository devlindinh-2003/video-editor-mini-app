import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import * as fs from 'fs';
import * as path from 'path';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({
          status: 'ok',
          service: 'VideoService',
        });
      });
  });

  describe('/api/video/files/:filename (GET)', () => {
    const exportsDir = path.resolve('data/exports');
    const dummyFilename = 'e2e-test-video.mp4';
    const dummyFilePath = path.join(exportsDir, dummyFilename);
    const dummyContent = 'dummy mp4 file content';

    beforeAll(() => {
      fs.mkdirSync(exportsDir, { recursive: true });
      fs.writeFileSync(dummyFilePath, dummyContent, 'utf8');
    });

    afterAll(() => {
      try {
        if (fs.existsSync(dummyFilePath)) {
          fs.unlinkSync(dummyFilePath);
        }
      } catch {
        // ignore
      }
    });

    it('should download an exported file successfully', () => {
      return request(app.getHttpServer())
        .get(`/api/video/files/${dummyFilename}`)
        .expect(200)
        .expect('Content-Type', 'video/mp4')
        .expect(
          'Content-Disposition',
          `attachment; filename="${dummyFilename}"`,
        )
        .expect('Content-Length', dummyContent.length.toString())
        .expect((res) => {
          const body = res.body as unknown;
          if (Buffer.isBuffer(body)) {
            expect(body.toString('utf8')).toBe(dummyContent);
          } else {
            throw new Error('Response body is not a Buffer');
          }
        });
    });

    it('should return 404 for a non-existent file', () => {
      return request(app.getHttpServer())
        .get('/api/video/files/does-not-exist.mp4')
        .expect(404);
    });

    it('should return 400 for a path traversal attempt', () => {
      return request(app.getHttpServer())
        .get('/api/video/files/..%2fetc%2fpasswd')
        .expect(400);
    });

    it('should return 400 for an invalid filename character pattern', () => {
      return request(app.getHttpServer())
        .get('/api/video/files/invalid_char!.mp4')
        .expect(400);
    });
  });
});
