import {
  Controller,
  Get,
  Post,
  Body,
  UsePipes,
  ValidationPipe,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { VideoService } from './video.service';
import { DownloadVideoDto } from './dto/download-video.dto';
import { ExportVideoDto } from './dto/export-video.dto';
import * as path from 'path';
import type { Response } from 'express';

@Controller()
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  @Get('health')
  getHealth() {
    return this.videoService.getHealthStatus();
  }

  @Post('api/video/download')
  downloadVideo(@Body() downloadVideoDto: DownloadVideoDto) {
    return this.videoService.downloadVideo(downloadVideoDto.url);
  }

  @Post('api/video/export')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async exportVideo(@Body() exportVideoDto: ExportVideoDto) {
    const finalPath = await this.videoService.exportVideo(
      exportVideoDto.sourceFile,
      exportVideoDto.clips,
    );
    const filename = path.basename(finalPath);
    return {
      filename,
      downloadUrl: `/api/video/files/${filename}`,
    };
  }

  @Get('api/video/files/:filename')
  async getFile(
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, size } =
      await this.videoService.getExportFileStream(filename);

    const contentTypeMap: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska',
      '.webm': 'video/webm',
    };
    const ext = path.extname(filename).toLowerCase();
    const contentType = contentTypeMap[ext] ?? 'application/octet-stream';

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': size.toString(),
    });

    stream.on('error', (err) => {
      this.videoService.logStreamingFailure(filename, err);
    });

    return new StreamableFile(stream);
  }
}
