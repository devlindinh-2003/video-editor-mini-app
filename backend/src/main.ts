import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { VideoService } from './video/video.service';
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // 1. Auto-create required directories
  const dirs = [
    path.resolve('data'),
    path.resolve('data/downloads'),
    path.resolve('data/clips'),
    path.resolve('data/exports'),
    path.resolve('data/temp'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        logger.log(`Created directory: ${dir}`);
      } catch (err: any) {
        logger.error(`Failed to create directory ${dir}: ${err.message}`);
      }
    }
  }

  // 2. Fail-fast startup checks for ffmpeg and yt-dlp
  const videoService = app.get(VideoService);
  const [ffmpegInstalled, ytdlpInstalled] = await Promise.all([
    videoService.checkFfmpegInstalled(),
    videoService.checkYtDlpInstalled(),
  ]);

  if (!ffmpegInstalled || !ytdlpInstalled) {
    if (!ffmpegInstalled) {
      logger.error('FFmpeg is not installed or not available in PATH');
    }
    if (!ytdlpInstalled) {
      logger.error('yt-dlp is not installed or not available in PATH');
    }
    logger.error('Fail-fast check failed. Exiting...');
    process.exit(1);
  }

  logger.log('FFmpeg and yt-dlp check passed successfully.');

  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
