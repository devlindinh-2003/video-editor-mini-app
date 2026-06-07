import { Test, TestingModule } from '@nestjs/testing';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { BadRequestException } from '@nestjs/common';

describe('VideoController', () => {
  let controller: VideoController;
  let service: VideoService;

  beforeEach(async () => {
    const mockVideoService = {
      getHealthStatus: jest
        .fn()
        .mockReturnValue({ status: 'ok', service: 'VideoService' }),
      downloadVideo: jest.fn(),
      exportVideo: jest.fn(),
      getExportFileStream: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VideoController],
      providers: [
        {
          provide: VideoService,
          useValue: mockVideoService,
        },
      ],
    }).compile();

    controller = module.get<VideoController>(VideoController);
    service = module.get<VideoService>(VideoService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHealth', () => {
    it('should call getHealthStatus on VideoService', () => {
      const result = controller.getHealth();
      expect(service.getHealthStatus).toHaveBeenCalled();
      expect(result).toEqual({ status: 'ok', service: 'VideoService' });
    });
  });

  describe('downloadVideo', () => {
    const downloadDto = { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' };
    const successResult = {
      filename: 'dQw4w9WgXcQ.mp4',
      title: 'Rick Astley - Never Gonna Give You Up',
      duration: 212,
    };

    it('should call downloadVideo on VideoService with correct arguments and return result', async () => {
      jest.spyOn(service, 'downloadVideo').mockResolvedValue(successResult);

      const result = await controller.downloadVideo(downloadDto);

      expect(service.downloadVideo).toHaveBeenCalledWith(downloadDto.url);
      expect(result).toEqual(successResult);
    });

    it('should propagate errors from VideoService', async () => {
      const error = new BadRequestException('Invalid URL format');
      jest.spyOn(service, 'downloadVideo').mockRejectedValue(error);

      await expect(controller.downloadVideo(downloadDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(service.downloadVideo).toHaveBeenCalledWith(downloadDto.url);
    });
  });

  describe('exportVideo', () => {
    const exportDto = {
      sourceFile: 'video.mp4',
      clips: [{ start: '00:00:05', end: '00:00:10' }],
    };
    const successPath = '/absolute/path/to/data/exports/merged-123.mp4';
    const expectedResponse = {
      filename: 'merged-123.mp4',
      downloadUrl: '/api/video/files/merged-123.mp4',
    };

    it('should call exportVideo on VideoService and return mapped response', async () => {
      jest.spyOn(service, 'exportVideo').mockResolvedValue(successPath);

      const result = await controller.exportVideo(exportDto);

      expect(service.exportVideo).toHaveBeenCalledWith(
        exportDto.sourceFile,
        exportDto.clips,
      );
      expect(result).toEqual(expectedResponse);
    });

    it('should propagate errors from VideoService', async () => {
      const error = new BadRequestException('Invalid clip range');
      jest.spyOn(service, 'exportVideo').mockRejectedValue(error);

      await expect(controller.exportVideo(exportDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(service.exportVideo).toHaveBeenCalledWith(
        exportDto.sourceFile,
        exportDto.clips,
      );
    });
  });

  describe('getFile', () => {
    it('should call getExportFileStream on VideoService and set correct headers and return StreamableFile', async () => {
      const mockStream = {
        on: jest.fn().mockReturnThis(),
        pipe: jest.fn(),
      };
      const mockResponse = {
        set: jest.fn(),
      } as any;

      jest.spyOn(service, 'getExportFileStream').mockResolvedValue({
        stream: mockStream as any,
        size: 1024,
        filePath: '/path/to/file.mp4',
      });

      const result = await controller.getFile('file.mp4', mockResponse);

      expect(service.getExportFileStream).toHaveBeenCalledWith('file.mp4');
      expect(mockResponse.set).toHaveBeenCalledWith({
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="file.mp4"',
        'Content-Length': '1024',
      });
      expect(result).toBeDefined();
      expect(mockStream.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should propagate service errors', async () => {
      const mockResponse = {
        set: jest.fn(),
      } as any;
      jest
        .spyOn(service, 'getExportFileStream')
        .mockRejectedValue(new BadRequestException('Invalid filename'));

      await expect(
        controller.getFile('invalid.mp4', mockResponse),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
