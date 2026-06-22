import { forwardRef, Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { ToolModule } from 'src/tool/tool.module';

@Module({
  imports: [forwardRef(() => ToolModule)],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule { }
