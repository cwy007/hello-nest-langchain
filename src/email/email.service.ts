import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  transporter: Transporter;

  constructor(private readonly configService: ConfigService) {
    this.transporter = createTransport({
      host: this.configService.get<string>('MAIL_HOST'),
      port: this.configService.get<number>('MAIL_PORT'),
      secure: this.configService.get<boolean>('MAIL_SECURE'),
      auth: {
        user: this.configService.get<string>('MAIL_USER'),
        pass: this.configService.get<string>('MAIL_PASS'),
      },
    })
  }

  async sendEmail(to: string, subject: string, html: string) {
    if (!to) {
      throw new HttpException('收件人邮箱不能为空', HttpStatus.BAD_REQUEST);
    }
    await this.transporter.sendMail({
      from: {
        name: '会议室预订系统',
        address: this.configService.get<string>('MAIL_FROM')!,
      },
      to,
      subject,
      html,
    });
  }
}
