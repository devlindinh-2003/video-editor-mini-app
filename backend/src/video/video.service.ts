import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  getHealthStatus() {
    return { status: 'ok', service: 'VideoService' };
  }

  private parseToSeconds(timeStr: string): number {
    const [hours, minutes, seconds] = timeStr.split(':').map((p) => parseInt(p, 10));
    return hours * 3600 + minutes * 60 + seconds;
  }

  async checkYtDlpInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const process = spawn('yt-dlp', ['--version']);
      process.on('error', (err: any) => {
        if (err.code === 'ENOENT') {
          resolve(false);
        } else {
          resolve(true);
        }
      });
      process.on('close', (code) => {
        resolve(true);
      });
    });
  }

  async downloadVideo(
    url: string,
  ): Promise<{ filename: string; title: string; duration: number }> {
    if (!url) {
      throw new BadRequestException('URL is required');
    }
    if (typeof url !== 'string') {
      throw new BadRequestException('URL must be a string');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      throw new BadRequestException('Invalid URL format');
    }

    const hostname = parsedUrl.hostname;
    const validHosts = ['youtube.com', 'www.youtube.com', 'youtu.be'];
    if (!validHosts.includes(hostname)) {
      throw new BadRequestException('URL must be a YouTube URL');
    }

    const isInstalled = await this.checkYtDlpInstalled();
    if (!isInstalled) {
      throw new InternalServerErrorException(
        'yt-dlp is not installed on the host machine',
      );
    }

    // 1. Retrieve metadata
    let metadata: { title: string; duration: number; id: string; ext: string };
    try {
      metadata = await new Promise((resolve, reject) => {
        const child = spawn('yt-dlp', ['--dump-json', '--no-playlist', url]);
        let stdoutData = '';
        let stderrData = '';

        child.stdout.on('data', (data) => {
          stdoutData += data.toString();
        });

        child.stderr.on('data', (data) => {
          stderrData += data.toString();
        });

        child.on('error', (err) => {
          reject(err);
        });

        child.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Exit code ${code}: ${stderrData}`));
            return;
          }
          try {
            const parsed = JSON.parse(stdoutData);
            resolve({
              title: parsed.title,
              duration: Math.round(parsed.duration || 0),
              id: parsed.id,
              ext: parsed.ext || 'mp4',
            });
          } catch (e) {
            reject(new Error('Failed to parse metadata JSON'));
          }
        });
      });
    } catch (err) {
      throw new InternalServerErrorException(
        `Metadata retrieval failure: ${err.message}`,
      );
    }

    // 2. Ensure download directory exists
    const downloadsDir = path.resolve('data/downloads');
    try {
      fs.mkdirSync(downloadsDir, { recursive: true });
    } catch (err) {
      throw new InternalServerErrorException(
        `Failed to create downloads directory: ${err.message}`,
      );
    }

    // 3. Download video
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('yt-dlp', [
          '-f',
          'best[height<=480]/worst',
          '--no-playlist',
          '-P',
          downloadsDir,
          '-o',
          '%(id)s.%(ext)s',
          url,
        ]);

        let stderrData = '';
        child.stderr.on('data', (data) => {
          stderrData += data.toString();
        });

        child.on('error', (err) => {
          reject(err);
        });

        child.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Exit code ${code}: ${stderrData}`));
            return;
          }
          resolve();
        });
      });
    } catch (err) {
      throw new InternalServerErrorException(
        `Download failure: ${err.message}`,
      );
    }

    // Find the exact filename on disk to handle any extension difference
    let filename = `${metadata.id}.${metadata.ext}`;
    try {
      const files = fs.readdirSync(downloadsDir);
      const matchingFile = files.find((f) => f.startsWith(metadata.id + '.'));
      if (matchingFile) {
        filename = matchingFile;
      }
    } catch (e) {
      // Keep metadata format fallback
    }

    return {
      filename,
      title: metadata.title,
      duration: metadata.duration,
    };
  }

  async extractClip(
    inputFile: string,
    startTime: string,
    endTime: string,
  ): Promise<string> {
    // 1. Validate input file exists
    if (!inputFile || !fs.existsSync(inputFile)) {
      throw new BadRequestException('Input video file not found');
    }

    // 2. Validate timestamps format (HH:MM:SS only, no fractions)
    const hhMmSsRegex = /^\d{2}:[0-5]\d:[0-5]\d$/;
    if (
      !startTime ||
      !endTime ||
      !hhMmSsRegex.test(startTime) ||
      !hhMmSsRegex.test(endTime)
    ) {
      throw new BadRequestException('Invalid clip range');
    }

    const startSeconds = this.parseToSeconds(startTime);
    const endSeconds = this.parseToSeconds(endTime);

    // Validate end time > start time
    if (endSeconds <= startSeconds) {
      throw new BadRequestException('Invalid clip range');
    }

    // 3. Ensure output directory exists
    const clipsDir = path.resolve('data/clips');
    try {
      fs.mkdirSync(clipsDir, { recursive: true });
    } catch (err) {
      throw new InternalServerErrorException(
        `Failed to create clips directory: ${err.message}`,
      );
    }

    const ext = path.extname(inputFile).toLowerCase() || '.mp4';
    const uuid = crypto.randomUUID();
    const outputFilename = `clip_${uuid}${ext}`;
    const outputFile = path.join(clipsDir, outputFilename);

    // 4. Execute FFmpeg
    // Note: Stream copy (-c copy) is fast and avoids re-encoding, but it is not frame-accurate
    // because cuts will occur on the nearest keyframes (I-frames) before/after the specified timestamps.
    const args = [
      '-i',
      inputFile,
      '-ss',
      startTime,
      '-to',
      endTime,
      '-c',
      'copy',
      outputFile,
    ];

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('ffmpeg', args);
        let stderrData = '';

        child.stderr?.on('data', (data) => {
          stderrData += data.toString();
        });

        child.on('error', (err) => {
          reject(err);
        });

        child.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Exit code ${code}: ${stderrData}`));
          } else {
            resolve();
          }
        });
      });
    } catch (err) {
      throw new InternalServerErrorException(
        `FFmpeg clip extraction failed: ${err.message}`,
      );
    }

    return path.join('data/clips', outputFilename);
  }

  async checkFfmpegInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const process = spawn('ffmpeg', ['-version']);
      process.on('error', (err: any) => {
        if (err.code === 'ENOENT') {
          resolve(false);
        } else {
          resolve(true);
        }
      });
      process.on('close', () => {
        resolve(true);
      });
    });
  }

  async mergeClips(clipPaths: string[]): Promise<string> {
    // 1. Validate input clipPaths array
    if (!clipPaths || clipPaths.length < 2) {
      throw new BadRequestException('Minimum 2 clips required');
    }

    // 3. Validate extensions consistency and format
    const allowedExtensions = ['.mp4', '.mov', '.mkv', '.webm'];
    const extensions = clipPaths.map((p) => {
      if (!p || typeof p !== 'string') {
        throw new BadRequestException('Clip path must be a string');
      }
      return path.extname(p).toLowerCase();
    });

    const firstExt = extensions[0];
    if (!allowedExtensions.includes(firstExt)) {
      throw new BadRequestException(`Unsupported file type: ${firstExt}`);
    }

    for (let i = 1; i < extensions.length; i++) {
      if (extensions[i] !== firstExt) {
        throw new BadRequestException('All clips must use the same extension');
      }
    }

    // 4. Validate readability of each clip path (replaces existsSync + accessSync)
    for (const clipPath of clipPaths) {
      try {
        fs.accessSync(clipPath, fs.constants.R_OK);
      } catch (err) {
        throw new BadRequestException('One or more clip files do not exist');
      }
    }

    // 5. Check if FFmpeg is installed
    const ffmpegInstalled = await this.checkFfmpegInstalled();
    if (!ffmpegInstalled) {
      throw new InternalServerErrorException(
        'FFmpeg is not installed or not available in PATH',
      );
    }

    // 6. Ensure directories exist
    const tempDir = path.resolve('data/temp');
    const exportsDir = path.resolve('data/exports');
    try {
      fs.mkdirSync(tempDir, { recursive: true });
      fs.mkdirSync(exportsDir, { recursive: true });
    } catch (err) {
      throw new InternalServerErrorException(
        `Failed to create required directories: ${err.message}`,
      );
    }

    // 7. Generate temporary concat file path and write entries
    const timestamp = Date.now();
    const tempConcatFilePath = path.join(tempDir, `merge-${timestamp}.txt`);

    // Write file entries
    const entries: string[] = [];
    for (const clipPath of clipPaths) {
      const absolutePath = path.resolve(clipPath);

      // Reject unsupported paths that cannot be encoded correctly (e.g. newlines)
      if (/[\r\n]/.test(absolutePath)) {
        throw new BadRequestException('Unsupported file path');
      }

      // Encode path according to FFmpeg concat demuxer requirements
      // Backslash is escaped as \\, single quote is escaped as \'
      const escapedPath = absolutePath
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
      entries.push(`file '${escapedPath}'`);
    }

    try {
      fs.writeFileSync(tempConcatFilePath, entries.join('\n'), 'utf8');
    } catch (err) {
      throw new InternalServerErrorException(
        `Failed to write concat file: ${err.message}`,
      );
    }

    // 8. Output filename format: merged-YYYYMMDD-HHmmss<extension>
    const now = new Date();
    const YYYY = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const dateStr = `${YYYY}${MM}${DD}-${hh}${mm}${ss}`;
    const outputFilename = `merged-${dateStr}${firstExt}`;
    const outputPath = path.join(exportsDir, outputFilename);

    // 9. Execute FFmpeg concat demuxer
    const args = [
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      tempConcatFilePath,
      '-c',
      'copy',
      outputPath,
    ];

    let stderrData = '';

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('ffmpeg', args);

        child.stderr?.on('data', (data) => {
          stderrData += data.toString();
        });

        child.on('error', (err) => {
          reject(err);
        });

        child.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Exit code ${code}`));
          } else {
            resolve();
          }
        });
      });
    } catch (err) {
      this.logger.error(
        `FFmpeg clip merging failed. Exit details: ${err.message}. Stderr: ${stderrData}`,
      );
      throw new InternalServerErrorException('FFmpeg clip merging failed');
    } finally {
      // 10. Cleanup temp concat file
      try {
        fs.unlinkSync(tempConcatFilePath);
      } catch (cleanupErr) {
        this.logger.warn(
          `Failed to cleanup temp concat file ${tempConcatFilePath}: ${cleanupErr.message}`,
        );
      }
    }

    // 11. Verify output file exists
    if (!fs.existsSync(outputPath)) {
      this.logger.error(
        `FFmpeg finished but output file was not found at ${outputPath}`,
      );
      throw new InternalServerErrorException('FFmpeg clip merging failed');
    }

    return path.resolve(outputPath);
  }

  async exportVideo(
    sourceFile: string,
    clips: { start: string; end: string }[],
  ): Promise<string> {
    this.logger.log(
      `Export started: sourceFile=${sourceFile}, clips=${JSON.stringify(clips)}`,
    );

    if (!sourceFile) {
      throw new BadRequestException('Source file is required');
    }

    if (!clips || clips.length === 0) {
      throw new BadRequestException('At least one clip is required');
    }

    // Business validation: start < end and valid format
    const hhMmSsRegex = /^\d{2}:[0-5]\d:[0-5]\d$/;
    for (const clip of clips) {
      if (
        !clip.start ||
        !clip.end ||
        !hhMmSsRegex.test(clip.start) ||
        !hhMmSsRegex.test(clip.end)
      ) {
        throw new BadRequestException('Invalid clip range');
      }
      const startSec = this.parseToSeconds(clip.start);
      const endSec = this.parseToSeconds(clip.end);
      if (startSec >= endSec) {
        throw new BadRequestException('Invalid clip range');
      }
    }

    // 1. Verify source file exists and is strictly located inside data/downloads
    if (!sourceFile || typeof sourceFile !== 'string') {
      throw new BadRequestException('Source file is required');
    }

    if (sourceFile.includes('..') || path.isAbsolute(sourceFile)) {
      throw new BadRequestException('Invalid source file');
    }

    const safeFilename = path.basename(sourceFile);
    const downloadsDir = path.resolve('data/downloads');
    const sourcePath = path.resolve(downloadsDir, safeFilename);

    // Defense-in-depth path traversal check
    const relativePath = path.relative(downloadsDir, sourcePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      this.logger.warn(
        `Path traversal attempt in export: sourceFile=${sourceFile}`,
      );
      throw new BadRequestException('Invalid source file');
    }

    if (!fs.existsSync(sourcePath)) {
      this.logger.error(`Export failed: source file not found: ${sourcePath}`);
      throw new BadRequestException('Source video file not found');
    }

    const extractedClipPaths: string[] = [];

    try {
      // 2. Extract each clip using the existing extractClip functionality
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        this.logger.log(
          `Clip extraction progress: starting clip ${i + 1}/${clips.length} (${clip.start} to ${clip.end})`,
        );
        const clipPath = await this.extractClip(
          sourcePath,
          clip.start,
          clip.end,
        );
        extractedClipPaths.push(clipPath);
      }

      // 3. Merge or copy
      let finalPath: string;
      if (extractedClipPaths.length === 1) {
        const firstExt = path.extname(extractedClipPaths[0]).toLowerCase();
        const exportsDir = path.resolve('data/exports');
        fs.mkdirSync(exportsDir, { recursive: true });

        const now = new Date();
        const YYYY = now.getFullYear();
        const MM = String(now.getMonth() + 1).padStart(2, '0');
        const DD = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const dateStr = `${YYYY}${MM}${DD}-${hh}${mm}${ss}`;
        const outputFilename = `merged-${dateStr}${firstExt}`;

        finalPath = path.join(exportsDir, outputFilename);
        fs.copyFileSync(extractedClipPaths[0], finalPath);
      } else {
        this.logger.log(`Merge started for ${extractedClipPaths.length} clips`);
        finalPath = await this.mergeClips(extractedClipPaths);
      }

      const resolvedFinalPath = path.resolve(finalPath);
      this.logger.log(`Export completed: finalPath=${resolvedFinalPath}`);
      return resolvedFinalPath;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Export failed: ${errMsg}`);
      throw err;
    } finally {
      // 4. Clean up temporary intermediate clip files, but preserve the final exported file
      for (const clipPath of extractedClipPaths) {
        try {
          if (fs.existsSync(clipPath)) {
            fs.unlinkSync(clipPath);
          }
        } catch (cleanupErr) {
          const cleanupErrMsg =
            cleanupErr instanceof Error
              ? cleanupErr.message
              : String(cleanupErr);
          this.logger.warn(
            `Failed to cleanup temp clip file ${clipPath}: ${cleanupErrMsg}`,
          );
        }
      }
    }
  }

  async getExportFileStream(
    filename: string,
  ): Promise<{ stream: fs.ReadStream; size: number; filePath: string }> {
    if (!filename || typeof filename !== 'string') {
      throw new BadRequestException('Filename is required');
    }

    // 1. Upfront filename validation (prevent traversal, slashes, and enforce safe pattern)
    if (
      filename.includes('/') ||
      filename.includes('\\') ||
      filename.includes('..') ||
      filename.includes('\0')
    ) {
      throw new BadRequestException('Invalid filename');
    }

    const lowerFilename = filename.toLowerCase();
    if (
      lowerFilename.includes('%2f') ||
      lowerFilename.includes('%5c') ||
      lowerFilename.includes('%2e')
    ) {
      throw new BadRequestException('Invalid filename');
    }

    const safePattern = /^[a-zA-Z0-9._-]+$/;
    if (!safePattern.test(filename)) {
      throw new BadRequestException('Invalid filename');
    }

    const exportsDir = path.resolve('data/exports');
    const resolvedPath = path.resolve(exportsDir, filename);

    // 2. Defense-in-depth resolved-path validation
    const relativePath = path.relative(exportsDir, resolvedPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      this.logger.warn(`Path traversal attempt detected: filename=${filename}`);
      throw new BadRequestException('Invalid filename');
    }

    this.logger.log(`File download requested: filename=${filename}, resolvedPath=${resolvedPath}`);

    // 3. Filesystem existence and type check (Async)
    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(resolvedPath);
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as Record<string, unknown>).code === 'ENOENT'
      ) {
        this.logger.warn(`File not found: ${resolvedPath}`);
        throw new NotFoundException('File not found');
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Error checking file stats for ${resolvedPath}: ${errMsg}`,
      );
      throw new InternalServerErrorException('Failed to read file');
    }

    if (!stats.isFile()) {
      this.logger.warn(`Path is not a file: ${resolvedPath}`);
      throw new NotFoundException('File not found');
    }

    try {
      const stream = fs.createReadStream(resolvedPath);
      return { stream, size: stats.size, filePath: resolvedPath };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to create read stream for ${resolvedPath}: ${errMsg}`,
      );
      throw new InternalServerErrorException('Failed to open file stream');
    }
  }

  logStreamingFailure(filename: string, error: Error) {
    this.logger.error(`Streaming failure for ${filename}: ${error.message}`);
  }
}
