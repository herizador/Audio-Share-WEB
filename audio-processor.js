// audio-processor.js
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // --- CONFIGURACIÓN DE AUDIO PARA COMPATIBILIDAD CON APP ---
        this.appSampleRate = 16000;  // Sample rate de la app
        this.contextSampleRate = sampleRate;  // Sample rate real del contexto
        this.resampleRatio = this.contextSampleRate / this.appSampleRate; // Corregido el ratio
        
        // --- CONFIGURACIÓN DE BUFFERS ---
        this.MAX_QUEUE_SIZE = 60;     // Reducido para menor latencia
        this.MIN_BUFFER_THRESHOLD = 15;  // Reducido para menor delay
        this.OPTIMAL_BUFFER_SIZE = 30;   // Ajustado para mejor respuesta
        
        // --- CONTROL DE CALIDAD DE AUDIO ---
        this.smoothingFactor = 0.7;   // Ajustado para mejor balance
        this.previousFrame = new Float32Array(128).fill(0);
        this.currentFrame = new Float32Array(128).fill(0);
        
        // --- CONTROL DE ESTADO ---
        this.underrunCount = 0;
        this.lastUnderrunTime = 0;
        this.processingStartTime = currentTime;
        this.totalProcessedFrames = 0;
        
        // Buffer circular más pequeño para menor latencia
        this.circularBuffer = new Float32Array(512).fill(0);
        this.circularBufferIndex = 0;
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
                    const processedBuffer = this.preprocessAudioBuffer(event.data.buffer);
                    if (processedBuffer) {
                        this.audioQueue.push(processedBuffer);
                    }
                } else {
                    // Mantener buffer fresco
                    this.audioQueue.shift();
                    const processedBuffer = this.preprocessAudioBuffer(event.data.buffer);
                    if (processedBuffer) {
                        this.audioQueue.push(processedBuffer);
                    }
                }
            } else if (event.data.type === 'play') {
                this.isPlaying = true;
                this.processingStartTime = currentTime;
                this.totalProcessedFrames = 0;
            } else if (event.data.type === 'pause') {
                this.isPlaying = false;
            } else if (event.data.type === 'stop') {
                this.isPlaying = false;
                this.audioQueue = [];
                this.previousFrame.fill(0);
                this.currentFrame.fill(0);
                this.circularBuffer.fill(0);
                this.circularBufferIndex = 0;
                this.processingStartTime = currentTime;
                this.totalProcessedFrames = 0;
            }
        };
    }

    preprocessAudioBuffer(buffer) {
        try {
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            const float32Buffer = new Float32Array(int16Buffer.length);
            
            // Normalización simple y directa
            const scale = 1.0 / 32768.0;
            for (let i = 0; i < int16Buffer.length; i++) {
                float32Buffer[i] = int16Buffer[i] * scale;
            }
            
            return float32Buffer;
        } catch (error) {
            console.error('Error preprocessing buffer:', error);
            return null;
        }
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (this.audioQueue.length < this.MIN_BUFFER_THRESHOLD || !this.isPlaying) {
            if (this.isPlaying && this.audioQueue.length === 0) {
                if (currentTime - this.lastUnderrunTime < 1) {
                    this.underrunCount++;
                    if (this.underrunCount > 2) {
                        this.MIN_BUFFER_THRESHOLD = Math.min(25, this.MIN_BUFFER_THRESHOLD + 2);
                        this.underrunCount = 0;
                    }
                } else {
                    this.underrunCount = 0;
                }
                this.lastUnderrunTime = currentTime;
            }
            
            // Fade out suave
            for (let i = 0; i < channel.length; i++) {
                this.circularBuffer[this.circularBufferIndex] *= 0.95;
                channel[i] = this.circularBuffer[this.circularBufferIndex];
                this.circularBufferIndex = (this.circularBufferIndex + 1) % this.circularBuffer.length;
            }
            return true;
        }

        const currentBuffer = this.audioQueue.shift();
        if (!currentBuffer) {
            for (let i = 0; i < channel.length; i++) {
                channel[i] = this.circularBuffer[this.circularBufferIndex] * 0.95;
                this.circularBufferIndex = (this.circularBufferIndex + 1) % this.circularBuffer.length;
            }
            return true;
        }

        try {
            const inputLength = currentBuffer.length;
            const outputLength = channel.length;
            
            // Remuestreo lineal simple y directo
            const step = 1 / this.resampleRatio;
            
            for (let i = 0; i < outputLength; i++) {
                const inputIndex = Math.floor(i * step);
                const nextInputIndex = Math.min(inputIndex + 1, inputLength - 1);
                const fraction = i * step - inputIndex;
                
                // Interpolación lineal simple
                const currentSample = inputIndex < inputLength ? currentBuffer[inputIndex] : 0;
                const nextSample = nextInputIndex < inputLength ? currentBuffer[nextInputIndex] : currentSample;
                const interpolatedSample = currentSample + (nextSample - currentSample) * fraction;
                
                // Suavizado simple
                this.circularBuffer[this.circularBufferIndex] = 
                    this.circularBuffer[this.circularBufferIndex] * this.smoothingFactor + 
                    interpolatedSample * (1 - this.smoothingFactor);
                
                channel[i] = this.circularBuffer[this.circularBufferIndex];
                this.circularBufferIndex = (this.circularBufferIndex + 1) % this.circularBuffer.length;
            }
            
            this.totalProcessedFrames += inputLength;
            
        } catch (error) {
            console.error('Error processing audio frame:', error);
            for (let i = 0; i < channel.length; i++) {
                channel[i] = this.circularBuffer[this.circularBufferIndex];
                this.circularBufferIndex = (this.circularBufferIndex + 1) % this.circularBuffer.length;
            }
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);
