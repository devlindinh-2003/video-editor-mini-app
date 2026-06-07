import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ClipDto } from './clip.dto';

export class ExportVideoDto {
  @IsString()
  @IsNotEmpty()
  sourceFile: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ClipDto)
  clips: ClipDto[];
}
