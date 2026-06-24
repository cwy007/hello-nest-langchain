import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { TtsRelayService } from './speech/tts-relay.service';
import { WebSocketServer } from 'ws';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // app.useStaticAssets('public', {
  //   prefix: '/public/',
  // });

  app.enableCors({
    origin: '*',
    credentials: true,
  })

  app.useGlobalPipes(new ValidationPipe({
    transform: true,
  }));

  const ttsRelayService = app.get(TtsRelayService);
  const server = app.getHttpServer();

  const ttsWss = new WebSocketServer({
    server,
    path: '/speech/tts/ws',
  })

  ttsWss.on('connection', (socket, request) => {
    const reqUrl = new URL(request.url ?? '', 'http://localhost');
    const wantedSessionId = reqUrl.searchParams.get('sessionId') ?? undefined;
    const sessionId = ttsRelayService.registerClient(socket, wantedSessionId);
    console.log(`New TTS WebSocket connection established. Session ID: ${sessionId}`);

    socket.on('close', () => {
      ttsRelayService.unregisterClient(sessionId);
      console.log(`TTS WebSocket connection closed. Session ID: ${sessionId}`);
    });
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
