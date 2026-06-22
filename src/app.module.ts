import { Inject, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BookModule } from './book/book.module';
import { AiModule } from './ai/ai.module';
import * as path from 'path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { EmailModule } from './email/email.module';
import { MailerModule } from '@nestjs-modules/mailer';
import { TypeOrmModule } from '@nestjs/typeorm';
import { utilities, WINSTON_MODULE_NEST_PROVIDER, WinstonLogger, WinstonModule } from 'nest-winston';
import winston from 'winston';
import 'winston-daily-rotate-file';
import { authPlugins } from 'mysql2';
import { CustomTypeOrmLogger } from './CustomTypeOrmLogger';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { UsersModule } from './users/users.module';
import { User } from './users/entities/user.entity';
import { CronExpression, ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { JobModule } from './job/job.module';
import { Job } from './job/entities/job.entity';
import { ToolModule } from './tool/tool.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.join(
        __dirname,
        process.env.NODE_ENV === 'production' ? '.env.production' : '.env',
      ),
    }),
    ServeStaticModule.forRoot({
      rootPath: path.join(__dirname, '..', 'public'),
      serveRoot: '/public',
    }),
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        transport: {
          host: configService.get<string>('MAIL_HOST'),
          port: Number(configService.get<string>('MAIL_PORT')),
          secure: configService.get<string>('MAIL_SECURE') === 'true',
          auth: {
            user: configService.get<string>('MAIL_USER'),
            pass: configService.get<string>('MAIL_PASS'),
          },
        },
        defaults: {
          from:
            configService.get<string>('MAIL_FROM')
        },
      }),
    }),
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService, logger: WinstonLogger) => {
        return {
          type: 'mysql',
          host: configService.get<string>('mysql_server_host'),
          port: configService.get<number>('mysql_server_port'),
          username: configService.get<string>('mysql_server_username'),
          password: configService.get<string>('mysql_server_password'),
          database: configService.get<string>('mysql_server_database'),
          entities: [User, Job],
          synchronize: true, // 生产环境建议关闭自动同步，使用迁移工具管理数据库结构
          logging: true,
          logger: new CustomTypeOrmLogger(logger),
          poolSize: 10,
          connectorPackage: 'mysql2',
          extra: {
            authPlugins: {
              sha256_password: authPlugins.sha256_password,
            },
          },
          namingStrategy: new SnakeNamingStrategy(), // 将数据库表和列名转换为下划线命名风格
          timezone: '+08:00', // 设置时区为东八区
        };
      },
      inject: [ConfigService, WINSTON_MODULE_NEST_PROVIDER],
    }),
    WinstonModule.forRootAsync({
      useFactory: () => ({
        level: 'debug',
        transports: [
          // new winston.transports.File({
          //   filename: `${process.cwd()}/log`,
          // }),
          new winston.transports.DailyRotateFile({
            level: 'debug',
            dirname: `${process.cwd()}/logs`,
            filename: 'application-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            // maxFiles: '14d',
            format: winston.format.combine(
              winston.format.timestamp(),
              utilities.format.nestLike(),
            ),
          }),
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.timestamp(),
              utilities.format.nestLike(),
            ),
          }),
          // new winston.transports.Http({
          //   level: 'error',
          //   host: 'localhost',
          //   port: 9200,
          //   path: '/logs',
          // })
        ],
      })
    }),
    BookModule,
    AiModule,
    EmailModule,
    UsersModule,
    JobModule,
    ToolModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  @Inject(SchedulerRegistry)
  private schedulerRegistry: SchedulerRegistry;

  // async onApplicationBootstrap() {
  //   const job = new CronJob(CronExpression.EVERY_SECOND, () => {
  //     console.log('run cron job every second');
  //   });

  //   this.schedulerRegistry.addCronJob('job1', job);
  //   job.start();
  //   setTimeout(() => {
  //     job.stop();
  //     console.log('cron job has been stopped');
  //   }, 10000);

  //   const intervalRef = setInterval(() => {
  //     console.log('run interval job every 5 seconds');
  //   }, 5000);
  //   this.schedulerRegistry.addInterval('interval1', intervalRef);
  //   setTimeout(() => {
  //     this.schedulerRegistry.deleteInterval('interval1');
  //     console.log('interval job has been stopped');
  //   }, 20000);

  //   const timeoutRef = setTimeout(() => {
  //     console.log('run timeout job after 10 seconds');
  //   }, 10000);
  //   this.schedulerRegistry.addTimeout('timeout1', timeoutRef);
  //   setTimeout(() => {
  //     this.schedulerRegistry.deleteTimeout('timeout1');
  //     console.log('timeout job has been stopped');
  //   }, 15000);
  // }
}
