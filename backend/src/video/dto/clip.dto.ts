import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class ClipDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:[0-5]\d:[0-5]\d$/, {
    message: 'start time must be in HH:MM:SS format',
  })
  start: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:[0-5]\d:[0-5]\d$/, {
    message: 'end time must be in HH:MM:SS format',
  })
  end: string;
}
