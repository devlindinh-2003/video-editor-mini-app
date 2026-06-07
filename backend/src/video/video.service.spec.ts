import { Test, TestingModule } from '@nestjs/testing';
import { VideoService } from './video.service';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// Mock child_process.spawn
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

const mockStat = jest.fn();
const mockCreateReadStream = jest.fn();

// Mock fs module
jest.mock('fs', () => {
  const original = jest.requireActual('fs');
  return {
    ...original,
    mkdirSync: jest.fn(),
    readdirSync: jest.fn(),
    existsSync: jest.fn(),
    accessSync: jest.fn(),
    writeFileSync: jest.fn(),
    unlinkSync: jest.fn(),
    copyFileSync: jest.fn(),
    promises: {
      ...original.promises,
      stat: (path: string) => mockStat(path),
    },
    createReadStream: (path: string) => mockCreateReadStream(path),
  };
});

const mockSpawn = spawn as jest.Mock;
const mockMkdirSync = fs.mkdirSync as jest.Mock;
const mockReaddirSync = fs.readdirSync as jest.Mock;
const mockExistsSync = fs.existsSync as jest.Mock;
const mockAccessSync = fs.accessSync as jest.Mock;
const mockWriteFileSync = fs.writeFileSync as jest.Mock;
const mockUnlinkSync = fs.unlinkSync as jest.Mock;
const mockCopyFileSync = fs.copyFileSync as jest.Mock;

function createMockProcess(options: {
  stdoutData?: string;
  stderrData?: string;
  exitCode?: number;
  error?: any;
}) {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  if (options.error) {
    process.nextTick(() => {
      proc.emit('error', options.error);
    });
  } else {
    process.nextTick(() => {
      if (options.stdoutData !== undefined) {
        proc.stdout.emit('data', Buffer.from(options.stdoutData));
      }
      if (options.stderrData !== undefined) {
        proc.stderr.emit('data', Buffer.from(options.stderrData));
      }
      proc.emit('close', options.exitCode ?? 0);
    });
  }
  return proc;
}

describe('VideoService', () => {
  let service: VideoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VideoService],
    }).compile();

    service = module.get<VideoService>(VideoService);

    mockSpawn.mockReset();
    mockMkdirSync.mockReset();
    mockReaddirSync.mockReset();
    mockExistsSync.mockReset();
    mockAccessSync.mockReset();
    mockWriteFileSync.mockReset();
    mockUnlinkSync.mockReset();
    mockCopyFileSync.mockReset();
    mockStat.mockReset();
    mockCreateReadStream.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('downloadVideo', () => {
    const validUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

    it('should download a YouTube video and return metadata on success', async () => {
      // Mock successful processes
      mockSpawn.mockImplementation((command, args) => {
        if (args[0] === '--version') {
          return createMockProcess({ exitCode: 0 });
        }
        if (args[0] === '--dump-json') {
          return createMockProcess({
            stdoutData: JSON.stringify({
              title: 'Rick Astley - Never Gonna Give You Up',
              duration: 212.3,
              id: 'dQw4w9WgXcQ',
              ext: 'mp4',
            }),
            exitCode: 0,
          });
        }
        // Download command
        return createMockProcess({ exitCode: 0 });
      });

      mockReaddirSync.mockReturnValue(['dQw4w9WgXcQ.mp4']);

      const result = await service.downloadVideo(validUrl);

      expect(result).toEqual({
        filename: 'dQw4w9WgXcQ.mp4',
        title: 'Rick Astley - Never Gonna Give You Up',
        duration: 212,
      });

      // Verify directory was created
      expect(mockMkdirSync).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
      });

      // Verify correct spawn commands
      expect(mockSpawn).toHaveBeenCalledTimes(3);

      // Check version check
      expect(mockSpawn.mock.calls[0][0]).toBe('yt-dlp');
      expect(mockSpawn.mock.calls[0][1]).toEqual(['--version']);

      // Check metadata retrieval
      expect(mockSpawn.mock.calls[1][0]).toBe('yt-dlp');
      expect(mockSpawn.mock.calls[1][1]).toEqual([
        '--dump-json',
        '--no-playlist',
        validUrl,
      ]);

      // Check download
      expect(mockSpawn.mock.calls[2][0]).toBe('yt-dlp');
      expect(mockSpawn.mock.calls[2][1]).toEqual([
        '-f',
        'best[height<=480]/worst',
        '--no-playlist',
        '-P',
        path.resolve('data/downloads'),
        '-o',
        '%(id)s.%(ext)s',
        validUrl,
      ]);
    });

    it('should throw BadRequestException if URL is missing', async () => {
      await expect(service.downloadVideo('')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.downloadVideo(undefined as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if URL is not a string', async () => {
      await expect(service.downloadVideo(123 as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for invalid URL format', async () => {
      await expect(service.downloadVideo('not-a-url')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for non-YouTube hostnames', async () => {
      await expect(service.downloadVideo('https://google.com')).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.downloadVideo('https://vimeo.com/12345'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException if yt-dlp is not installed', async () => {
      mockSpawn.mockImplementation((command, args) => {
        if (args[0] === '--version') {
          return createMockProcess({ error: { code: 'ENOENT' } });
        }
        return createMockProcess({ exitCode: 0 });
      });

      await expect(service.downloadVideo(validUrl)).rejects.toThrow(
        new InternalServerErrorException(
          'yt-dlp is not installed on the host machine',
        ),
      );
    });

    it('should throw InternalServerErrorException if metadata retrieval fails', async () => {
      mockSpawn.mockImplementation((command, args) => {
        if (args[0] === '--version') {
          return createMockProcess({ exitCode: 0 });
        }
        if (args[0] === '--dump-json') {
          return createMockProcess({
            stderrData: 'Could not resolve host',
            exitCode: 1,
          });
        }
        return createMockProcess({ exitCode: 0 });
      });

      await expect(service.downloadVideo(validUrl)).rejects.toThrow(
        /Metadata retrieval failure: Exit code 1: Could not resolve host/,
      );
    });

    it('should throw InternalServerErrorException if metadata parsing fails', async () => {
      mockSpawn.mockImplementation((command, args) => {
        if (args[0] === '--version') {
          return createMockProcess({ exitCode: 0 });
        }
        if (args[0] === '--dump-json') {
          return createMockProcess({
            stdoutData: '{invalid-json}',
            exitCode: 0,
          });
        }
        return createMockProcess({ exitCode: 0 });
      });

      await expect(service.downloadVideo(validUrl)).rejects.toThrow(
        /Metadata retrieval failure: Failed to parse metadata JSON/,
      );
    });

    it('should throw InternalServerErrorException if download fails', async () => {
      mockSpawn.mockImplementation((command, args) => {
        if (args[0] === '--version') {
          return createMockProcess({ exitCode: 0 });
        }
        if (args[0] === '--dump-json') {
          return createMockProcess({
            stdoutData: JSON.stringify({
              title: 'Test',
              duration: 10,
              id: 'dQw4w9WgXcQ',
              ext: 'mp4',
            }),
            exitCode: 0,
          });
        }
        // Download command fails
        return createMockProcess({
          stderrData: 'Disk full or download error',
          exitCode: 1,
        });
      });

      await expect(service.downloadVideo(validUrl)).rejects.toThrow(
        /Download failure: Exit code 1: Disk full or download error/,
      );
    });

    it('should handle missing downloads folder creation error', async () => {
      mockSpawn.mockImplementation((command, args) => {
        if (args[0] === '--version') {
          return createMockProcess({ exitCode: 0 });
        }
        if (args[0] === '--dump-json') {
          return createMockProcess({
            stdoutData: JSON.stringify({
              title: 'Test',
              duration: 10,
              id: 'dQw4w9WgXcQ',
              ext: 'mp4',
            }),
            exitCode: 0,
          });
        }
        return createMockProcess({ exitCode: 0 });
      });

      mockMkdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(service.downloadVideo(validUrl)).rejects.toThrow(
        /Failed to create downloads directory: Permission denied/,
      );
    });
  });

  describe('extractClip', () => {
    const validFile = 'data/downloads/sample.mp4';
    const startTime = '00:00:10';
    const endTime = '00:00:20';

    it('should successfully extract a clip and return output path', async () => {
      mockExistsSync.mockReturnValue(true);
      mockSpawn.mockReturnValue(createMockProcess({ exitCode: 0 }));

      const result = await service.extractClip(validFile, startTime, endTime);

      expect(result).toMatch(/^data\/clips\/clip_[a-f0-9-]+\.mp4$/);
      expect(mockExistsSync).toHaveBeenCalledWith(validFile);
      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('data/clips'),
        { recursive: true },
      );
      expect(mockSpawn).toHaveBeenCalledWith('ffmpeg', [
        '-i',
        validFile,
        '-ss',
        startTime,
        '-to',
        endTime,
        '-c',
        'copy',
        expect.stringContaining('clip_'),
      ]);
    });

    it('should verify output directory creation', async () => {
      mockExistsSync.mockReturnValue(true);
      mockSpawn.mockReturnValue(createMockProcess({ exitCode: 0 }));

      await service.extractClip(validFile, startTime, endTime);

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('data/clips'),
        { recursive: true },
      );
    });

    it('should throw BadRequestException if input file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(
        service.extractClip(validFile, startTime, endTime),
      ).rejects.toThrow(new BadRequestException('Input video file not found'));
    });

    it('should throw BadRequestException for invalid format of timestamps', async () => {
      mockExistsSync.mockReturnValue(true);

      // Empty timestamp
      await expect(service.extractClip(validFile, '', endTime)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.extractClip(validFile, startTime, ''),
      ).rejects.toThrow(BadRequestException);

      // Invalid HH:MM:SS format
      await expect(
        service.extractClip(validFile, '10', endTime),
      ).rejects.toThrow(BadRequestException);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if end time <= start time', async () => {
      mockExistsSync.mockReturnValue(true);

      await expect(
        service.extractClip(validFile, '00:00:20', '00:00:10'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.extractClip(validFile, '00:00:10', '00:00:10'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException on FFmpeg failure', async () => {
      mockExistsSync.mockReturnValue(true);
      mockSpawn.mockReturnValue(
        createMockProcess({ exitCode: 1, stderrData: 'FFmpeg error' }),
      );

      await expect(
        service.extractClip(validFile, startTime, endTime),
      ).rejects.toThrow(/FFmpeg clip extraction failed/);
    });

    it('should dynamically preserve container format (e.g. .webm)', async () => {
      mockExistsSync.mockReturnValue(true);
      mockSpawn.mockReturnValue(createMockProcess({ exitCode: 0 }));

      const webmFile = 'data/downloads/sample.webm';
      const result = await service.extractClip(webmFile, startTime, endTime);

      expect(result).toMatch(/^data\/clips\/clip_[a-f0-9-]+\.webm$/);
      expect(mockSpawn).toHaveBeenCalledWith('ffmpeg', [
        '-i',
        webmFile,
        '-ss',
        startTime,
        '-to',
        endTime,
        '-c',
        'copy',
        expect.stringContaining('clip_'),
      ]);
    });
  });

  describe('mergeClips', () => {
    const validClips = ['data/clips/clip1.mp4', 'data/clips/clip2.mp4'];

    it('should successfully merge clips and return output path', async () => {
      // Mock ffmpeg version check (returns true)
      // Mock ffmpeg merge (returns 0)
      mockSpawn.mockImplementation((command, args) => {
        if (command === 'ffmpeg' && args[0] === '-version') {
          return createMockProcess({ exitCode: 0 });
        }
        if (command === 'ffmpeg' && args[0] === '-f') {
          return createMockProcess({ exitCode: 0 });
        }
        return createMockProcess({ exitCode: 0 });
      });

      // Mock accessSync (successful readability check)
      mockAccessSync.mockImplementation(() => {});
      // Mock existsSync (for output verification)
      mockExistsSync.mockReturnValue(true);

      const result = await service.mergeClips(validClips);

      expect(result).toMatch(/merged-\d{8}-\d{6}\.mp4$/);
      expect(mockAccessSync).toHaveBeenCalledTimes(2);
      expect(mockWriteFileSync).toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalledTimes(2); // checkFfmpegInstalled + merge
      expect(mockUnlinkSync).toHaveBeenCalled(); // cleanup temp concat file
    });

    it('should successfully merge webm clips', async () => {
      mockSpawn.mockImplementation((command, args) => {
        if (command === 'ffmpeg' && args[0] === '-version') {
          return createMockProcess({ exitCode: 0 });
        }
        return createMockProcess({ exitCode: 0 });
      });
      mockAccessSync.mockImplementation(() => {});
      mockExistsSync.mockReturnValue(true);

      const webmClips = ['data/clips/clip1.webm', 'data/clips/clip2.webm'];
      const result = await service.mergeClips(webmClips);

      expect(result).toMatch(/merged-\d{8}-\d{6}\.webm$/);
    });

    it('should throw BadRequestException if fewer than 2 clips provided', async () => {
      await expect(service.mergeClips(['clip1.mp4'])).rejects.toThrow(
        new BadRequestException('Minimum 2 clips required'),
      );
      await expect(service.mergeClips([])).rejects.toThrow(
        new BadRequestException('Minimum 2 clips required'),
      );
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if a clip has an unsupported extension', async () => {
      mockSpawn.mockImplementation((command, args) => {
        if (command === 'ffmpeg' && args[0] === '-version') {
          return createMockProcess({ exitCode: 0 });
        }
        return createMockProcess({ exitCode: 0 });
      });
      await expect(
        service.mergeClips(['clip1.avi', 'clip2.mp4']),
      ).rejects.toThrow(new BadRequestException('Unsupported file type: .avi'));
    });

    it('should throw BadRequestException if clips have mismatched extensions', async () => {
      mockSpawn.mockImplementation((command, args) => {
        if (command === 'ffmpeg' && args[0] === '-version') {
          return createMockProcess({ exitCode: 0 });
        }
        return createMockProcess({ exitCode: 0 });
      });
      await expect(
        service.mergeClips(['clip1.mp4', 'clip2.mov']),
      ).rejects.toThrow(
        new BadRequestException('All clips must use the same extension'),
      );
    });

    it('should throw BadRequestException if clip is not readable/does not exist', async () => {
      mockSpawn.mockImplementation((command, args) => {
        if (command === 'ffmpeg' && args[0] === '-version') {
          return createMockProcess({ exitCode: 0 });
        }
        return createMockProcess({ exitCode: 0 });
      });
      mockAccessSync.mockImplementation(() => {
        throw new Error('Not readable');
      });

      await expect(service.mergeClips(validClips)).rejects.toThrow(
        new BadRequestException('One or more clip files do not exist'),
      );
    });

    it('should throw BadRequestException if a path contains newlines', async () => {
      mockSpawn.mockImplementation((command, args) => {
        if (command === 'ffmpeg' && args[0] === '-version') {
          return createMockProcess({ exitCode: 0 });
        }
        return createMockProcess({ exitCode: 0 });
      });
      mockAccessSync.mockImplementation(() => {});

      await expect(
        service.mergeClips(['clip1\n.mp4', 'clip2.mp4']),
      ).rejects.toThrow(new BadRequestException('Unsupported file path'));
    });

    it('should throw InternalServerErrorException if FFmpeg is not installed', async () => {
      // Mock ffmpeg version check failing with ENOENT
      mockSpawn.mockImplementation((command, args) => {
        if (command === 'ffmpeg' && args[0] === '-version') {
          return createMockProcess({ error: { code: 'ENOENT' } });
        }
        return createMockProcess({ exitCode: 0 });
      });

      await expect(service.mergeClips(validClips)).rejects.toThrow(
        new InternalServerErrorException(
          'FFmpeg is not installed or not available in PATH',
        ),
      );
    });

    it('should throw InternalServerErrorException and log internally if FFmpeg fails', async () => {
      mockSpawn.mockImplementation((command, args) => {
        if (command === 'ffmpeg' && args[0] === '-version') {
          return createMockProcess({ exitCode: 0 });
        }
        if (command === 'ffmpeg' && args[0] === '-f') {
          return createMockProcess({
            exitCode: 1,
            stderrData: 'Concat error details',
          });
        }
        return createMockProcess({ exitCode: 0 });
      });
      mockAccessSync.mockImplementation(() => {});

      const loggerSpy = jest.spyOn((service as any).logger, 'error');

      await expect(service.mergeClips(validClips)).rejects.toThrow(
        new InternalServerErrorException('FFmpeg clip merging failed'),
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'FFmpeg clip merging failed. Exit details: Exit code 1. Stderr: Concat error details',
        ),
      );
      expect(mockUnlinkSync).toHaveBeenCalled(); // cleanup still runs
    });

    it('should throw InternalServerErrorException if output file is not created', async () => {
      mockSpawn.mockImplementation((command, args) => {
        if (command === 'ffmpeg' && args[0] === '-version') {
          return createMockProcess({ exitCode: 0 });
        }
        return createMockProcess({ exitCode: 0 });
      });
      mockAccessSync.mockImplementation(() => {});
      mockExistsSync.mockReturnValue(false); // output file missing

      await expect(service.mergeClips(validClips)).rejects.toThrow(
        new InternalServerErrorException('FFmpeg clip merging failed'),
      );
      expect(mockUnlinkSync).toHaveBeenCalled(); // cleanup still runs
    });

    it('should escape path for FFmpeg concat demuxer format correctly', async () => {
      mockSpawn.mockImplementation((command, args) => {
        if (command === 'ffmpeg' && args[0] === '-version') {
          return createMockProcess({ exitCode: 0 });
        }
        return createMockProcess({ exitCode: 0 });
      });
      mockAccessSync.mockImplementation(() => {});
      mockExistsSync.mockReturnValue(true);

      const clipsWithSpecialChars = [
        "data/clips/clip's 1.mp4",
        'data/clips/clip\\2.mp4',
      ];

      await service.mergeClips(clipsWithSpecialChars);

      expect(mockWriteFileSync).toHaveBeenCalled();
      const writtenContent = mockWriteFileSync.mock.calls[0][1];

      // Verification of FFmpeg concat demuxer encoding:
      // backslashes -> \\\\, single quotes -> \\'
      expect(writtenContent).toContain("file '");
      expect(writtenContent).toContain("clip\\'s 1.mp4");
      expect(writtenContent).toContain('clip\\\\2.mp4');
    });
  });

  describe('exportVideo', () => {
    const sourceFile = 'video.mp4';
    const sourcePath = path.resolve('data/downloads', sourceFile);
    const clips = [
      { start: '00:00:05', end: '00:00:10' },
      { start: '00:00:12', end: '00:00:15' },
    ];

    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
      jest
        .spyOn(service, 'extractClip')
        .mockImplementation(async (input, start, end) => {
          return `data/clips/clip_mocked_${start.replace(/:/g, '')}.mp4`;
        });
      jest
        .spyOn(service, 'mergeClips')
        .mockImplementation(async (clipPaths) => {
          return path.resolve('data/exports/merged-mocked.mp4');
        });
    });

    it('should export a video from a single clip, produce a final file, and not call mergeClips', async () => {
      const singleClip = [{ start: '00:00:05', end: '00:00:10' }];

      const result = await service.exportVideo(sourceFile, singleClip);

      expect(result).toMatch(/merged-\d{8}-\d{6}\.mp4/);
      expect(service.extractClip).toHaveBeenCalledTimes(1);
      expect(service.extractClip).toHaveBeenCalledWith(
        sourcePath,
        '00:00:05',
        '00:00:10',
      );
      expect(service.mergeClips).not.toHaveBeenCalled();
      expect(mockCopyFileSync).toHaveBeenCalledWith(
        'data/clips/clip_mocked_000005.mp4',
        expect.stringContaining('merged-'),
      );

      // Cleanup check: temporary clip is unlinked
      expect(mockUnlinkSync).toHaveBeenCalledWith(
        'data/clips/clip_mocked_000005.mp4',
      );
      // Final output file (result) is NOT unlinked
      expect(mockUnlinkSync).not.toHaveBeenCalledWith(result);
    });

    it('should export a video from multiple clips and call mergeClips', async () => {
      const result = await service.exportVideo(sourceFile, clips);

      expect(result).toBe(path.resolve('data/exports/merged-mocked.mp4'));
      expect(service.extractClip).toHaveBeenCalledTimes(2);
      expect(service.extractClip).toHaveBeenNthCalledWith(
        1,
        sourcePath,
        '00:00:05',
        '00:00:10',
      );
      expect(service.extractClip).toHaveBeenNthCalledWith(
        2,
        sourcePath,
        '00:00:12',
        '00:00:15',
      );
      expect(service.mergeClips).toHaveBeenCalledWith([
        'data/clips/clip_mocked_000005.mp4',
        'data/clips/clip_mocked_000012.mp4',
      ]);

      // Cleanup check
      expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
      expect(mockUnlinkSync).toHaveBeenNthCalledWith(
        1,
        'data/clips/clip_mocked_000005.mp4',
      );
      expect(mockUnlinkSync).toHaveBeenNthCalledWith(
        2,
        'data/clips/clip_mocked_000012.mp4',
      );
      expect(mockUnlinkSync).not.toHaveBeenCalledWith(result);
    });

    it('should throw BadRequestException if source file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(service.exportVideo(sourceFile, clips)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should clean up intermediate clips if extractClip throws', async () => {
      jest
        .spyOn(service, 'extractClip')
        .mockResolvedValueOnce('data/clips/clip_mocked_1.mp4')
        .mockRejectedValueOnce(new Error('FFmpeg error'));

      await expect(service.exportVideo(sourceFile, clips)).rejects.toThrow(
        'FFmpeg error',
      );

      expect(mockUnlinkSync).toHaveBeenCalledWith(
        'data/clips/clip_mocked_1.mp4',
      );
    });

    it('should clean up intermediate clips if mergeClips throws', async () => {
      jest
        .spyOn(service, 'mergeClips')
        .mockRejectedValue(new Error('Merge error'));

      await expect(service.exportVideo(sourceFile, clips)).rejects.toThrow(
        'Merge error',
      );

      expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
      expect(mockUnlinkSync).toHaveBeenNthCalledWith(
        1,
        'data/clips/clip_mocked_000005.mp4',
      );
      expect(mockUnlinkSync).toHaveBeenNthCalledWith(
        2,
        'data/clips/clip_mocked_000012.mp4',
      );
    });

    it('should validate invalid clip ranges start >= end', async () => {
      const invalidClips1 = [{ start: '00:00:10', end: '00:00:05' }];
      const invalidClips2 = [{ start: '00:00:10', end: '00:00:10' }];

      await expect(
        service.exportVideo(sourceFile, invalidClips1),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.exportVideo(sourceFile, invalidClips2),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject path traversal attempts in sourceFile', async () => {
      const traversalFiles = [
        '../../etc/passwd',
        '/etc/passwd',
        'data/downloads/../../../etc/passwd',
      ];
      for (const traversalFile of traversalFiles) {
        await expect(service.exportVideo(traversalFile, clips)).rejects.toThrow(
          BadRequestException,
        );
      }
    });

    it('should sanitize sourceFile using basename', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return p.endsWith('some-video.mp4');
      });

      const result = await service.exportVideo('path/to/some-video.mp4', [
        { start: '00:00:05', end: '00:00:10' },
      ]);
      expect(result).toMatch(/merged-\d{8}-\d{6}\.mp4/);
    });
  });

  describe('getExportFileStream', () => {
    it('should return read stream, size and filePath for a valid filename', async () => {
      const mockStats = {
        isFile: () => true,
        size: 5000,
      };
      mockStat.mockResolvedValue(mockStats);
      const mockStream = {} as any;
      mockCreateReadStream.mockReturnValue(mockStream);

      const result = await service.getExportFileStream('test.mp4');

      expect(mockStat).toHaveBeenCalledWith(
        path.resolve('data/exports', 'test.mp4'),
      );
      expect(mockCreateReadStream).toHaveBeenCalledWith(
        path.resolve('data/exports', 'test.mp4'),
      );
      expect(result).toEqual({
        stream: mockStream,
        size: 5000,
        filePath: path.resolve('data/exports', 'test.mp4'),
      });
    });

    it('should throw BadRequestException if filename is not provided or empty', async () => {
      await expect(service.getExportFileStream('')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getExportFileStream(null as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for filenames containing directory slashes', async () => {
      await expect(service.getExportFileStream('dir/file.mp4')).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.getExportFileStream('dir\\file.mp4'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for filenames with traversal sequences', async () => {
      await expect(service.getExportFileStream('../file.mp4')).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.getExportFileStream('..%2ffile.mp4'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for filenames not matching safe pattern', async () => {
      await expect(service.getExportFileStream('file!.mp4')).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.getExportFileStream('file space.mp4'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if file does not exist', async () => {
      const error = new Error('File not found') as any;
      error.code = 'ENOENT';
      mockStat.mockRejectedValue(error);

      await expect(service.getExportFileStream('missing.mp4')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if path points to a directory', async () => {
      const mockStats = {
        isFile: () => false,
        size: 0,
      };
      mockStat.mockResolvedValue(mockStats);

      await expect(
        service.getExportFileStream('directory.mp4'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw InternalServerErrorException for other filesystem errors', async () => {
      mockStat.mockRejectedValue(new Error('Permission denied'));

      await expect(service.getExportFileStream('error.mp4')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
