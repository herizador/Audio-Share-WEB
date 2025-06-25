// audio-processor.js
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // --- CONFIGURACIÓN DE AUDIO PARA COMPATIBILIDAD CON APP ---
        this.appSampleRate = 16000;  // Sample rate de la app
        this.contextSampleRate = sampleRate;  // Sample rate real del contexto
        this.resampleRatio = this.appSampleRate / this.contextSampleRate;
        
        // --- CONFIGURACIÓN DE BUFFERS ---
        this.MAX_QUEUE_SIZE = 80;     // Reducido para menor latencia
        this.MIN_BUFFER_THRESHOLD = 20;  // Mínimo para evitar underruns
        this.OPTIMAL_BUFFER_SIZE = 40;   // Tamaño óptimo para calidad
        
        // --- CONTROL DE CALIDAD DE AUDIO ---
        this.smoothingFactor = 0.6;   // Reducido para menor distorsión
        this.previousFrame = new Float32Array(128).fill(0);
        this.currentFrame = new Float32Array(128).fill(0);
        
        // --- CONTROL DE ESTADO ---
        this.underrunCount = 0;
        this.lastUnderrunTime = 0;
        this.processingStartTime = currentTime;
        this.totalProcessedFrames = 0;
        
        // Buffer circular para suavizado
        this.circularBuffer = new Float32Array(1024).fill(0);
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
            
            // Normalización con escala ajustada
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
                        this.MIN_BUFFER_THRESHOLD = Math.min(30, this.MIN_BUFFER_THRESHOLD + 2);
                        this.underrunCount = 0;
                    }
                } else {
                    this.underrunCount = 0;
                }
                this.lastUnderrunTime = currentTime;
            }
            
            // Fade out suave usando el buffer circular
            for (let i = 0; i < channel.length; i++) {
                this.circularBuffer[this.circularBufferIndex] *= 0.95;
                channel[i] = this.circularBuffer[this.circularBufferIndex];
                this.circularBufferIndex = (this.circularBufferIndex + 1) % this.circularBuffer.length;
            }
            return true;
        }

        const currentBuffer = this.audioQueue.shift();
        if (!currentBuffer) {
            // Mantener último audio válido con fade out
            for (let i = 0; i < channel.length; i++) {
                channel[i] = this.circularBuffer[this.circularBufferIndex] * 0.95;
                this.circularBufferIndex = (this.circularBufferIndex + 1) % this.circularBuffer.length;
            }
            return true;
        }

        try {
            const inputLength = currentBuffer.length;
            const outputLength = channel.length;
            
            // Calcular paso para remuestreo
            const step = this.resampleRatio;
            let inputIndex = 0;
            
            for (let i = 0; i < outputLength; i++) {
                // Calcular índices para interpolación
                const index = Math.floor(i * step);
                const nextIndex = Math.min(index + 1, inputLength - 1);
                const fraction = i * step - index;
                
                // Obtener muestras para interpolación
                const sample1 = index < inputLength ? currentBuffer[index] : 0;
                const sample2 = nextIndex < inputLength ? currentBuffer[nextIndex] : sample1;
                
                // Interpolación cúbica para mejor calidad
                const previousSample = index > 0 ? currentBuffer[index - 1] : sample1;
                const nextNextSample = nextIndex + 1 < inputLength ? currentBuffer[nextIndex + 1] : sample2;
                
                const a0 = nextNextSample - sample2 - previousSample + sample1;
                const a1 = previousSample - sample1 - a0;
                const a2 = sample2 - previousSample;
                const a3 = sample1;
                
                const t = fraction;
                const t2 = t * t;
                const t3 = t2 * t;
                
                // Calcular muestra interpolada
                let interpolatedSample = a0 * t3 + a1 * t2 + a2 * t + a3;
                
                // Aplicar suavizado usando buffer circular
                this.circularBuffer[this.circularBufferIndex] = 
                    this.circularBuffer[this.circularBufferIndex] * this.smoothingFactor + 
                    interpolatedSample * (1 - this.smoothingFactor);
                
                channel[i] = this.circularBuffer[this.circularBufferIndex];
                this.circularBufferIndex = (this.circularBufferIndex + 1) % this.circularBuffer.length;
            }
            
            this.totalProcessedFrames += inputLength;
            
        } catch (error) {
            console.error('Error processing audio frame:', error);
            // Recuperación de error usando buffer circular
            for (let i = 0; i < channel.length; i++) {
                channel[i] = this.circularBuffer[this.circularBufferIndex];
                this.circularBufferIndex = (this.circularBufferIndex + 1) % this.circularBuffer.length;
            }
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);
