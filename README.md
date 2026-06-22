# Nest + Langchain

实现与豆包同款的语音功能。

![实现与豆包同款的语音功能。](https://cdn.jsdelivr.net/gh/cwy007/pic_bed@main/images/asr-stream.png)

首先是语音识别 ASR：

这个不需要流式，前端用 MediaRecorder 录音完成后，放到 FormData 里 post 传给后端，后端调用腾讯云的 asr 接口转成文本返回

之后前端用文本调用 ai 接口，通过 SSE 流式返回文本回答。

然后是语音合成 TTS：

这个一般都是要流式的，因为文本是流式生成的，不可能等文本全生成再播放语音，所以需要用流式语音合成的接口。

文字用 SSE 流式返回，但这个是基于 http 的文本协议，不适合返回二进制数据，所以需要再做一个 WebSocket 服务来推送语音数据。

SSE 那边流式生成文本之后，通过事件传给 WebSocket 服务，把文本推给腾讯云 tts 服务，那边返回语音数据之后用 ws 推给前端。

前端用 Audio 标签 + MediaSource + SourceBuffer 来实现流式的播放。

Audio 标签设置 MediaSource 为 object url 的 src，MediaSource 添加 SourceBuffer，然后就可以不断 push 二进制数据 ArrayBuffer 实现流式播放了。

![asr](https://cdn.jsdelivr.net/gh/cwy007/pic_bed@main/images/20260623012907092.png)
