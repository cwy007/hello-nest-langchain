import { forwardRef, Module } from '@nestjs/common';
import { UsersModule } from 'src/users/users.module';
import { JobModule } from 'src/job/job.module';
import { ChatModelService } from './chat-model.service';
import { CronJobToolService } from './cron-job-tool.service';
import { DbUsersCrudToolService } from './db-users-crud-tool.service';
import { QueryUserToolService } from './query-user-tool.service';
import { SendMailToolService } from './send-mail-tool.service';
import { TimeNowToolService } from './time-now-tool.service';
import { WebSearchToolService } from './web-search-tool.service';

@Module({
  imports: [UsersModule, forwardRef(() => JobModule)],
  providers: [
    ChatModelService,
    TimeNowToolService,
    QueryUserToolService,
    SendMailToolService,
    WebSearchToolService,
    DbUsersCrudToolService,
    CronJobToolService,
    {
      provide: 'CHAT_MODEL',
      useFactory: (service: ChatModelService) => service.model,
      inject: [ChatModelService],
    },
    {
      provide: 'QUERY_USER_TOOL',
      useFactory: (service: QueryUserToolService) => service.tool,
      inject: [QueryUserToolService],
    },
    {
      provide: 'SEND_MAIL_TOOL',
      useFactory: (service: SendMailToolService) => service.tool,
      inject: [SendMailToolService],
    },
    {
      provide: 'WEB_SEARCH_TOOL',
      useFactory: (service: WebSearchToolService) => service.tool,
      inject: [WebSearchToolService],
    },
    {
      provide: 'DB_USERS_CRUD_TOOL',
      useFactory: (service: DbUsersCrudToolService) => service.tool,
      inject: [DbUsersCrudToolService],
    },
    {
      provide: 'TIME_NOW_TOOL',
      useFactory: (service: TimeNowToolService) => service.tool,
      inject: [TimeNowToolService],
    },
    {
      provide: 'CRON_JOB_TOOL',
      useFactory: (service: CronJobToolService) => service.tool,
      inject: [CronJobToolService],
    },
  ],
  exports: [
    'CHAT_MODEL',
    'QUERY_USER_TOOL',
    'SEND_MAIL_TOOL',
    'WEB_SEARCH_TOOL',
    'DB_USERS_CRUD_TOOL',
    'TIME_NOW_TOOL',
    'CRON_JOB_TOOL',
  ],
})
export class ToolModule { }
