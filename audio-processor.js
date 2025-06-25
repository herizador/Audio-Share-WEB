// audio-processor.js
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // --- CONFIGURACIÓN DE AUDIO PARA COMPATIBILIDAD CON APP ---
        this.appSampleRate = 16000;  // Sample rate de la app
        this.contextSampleRate = 48000;  // Sample rate típico del contexto
        this.resampleRatio = this.contextSampleRate / this.appSampleRate;
        
        // --- CONFIGURACIÓN DE BUFFERS ---
        this.MAX_QUEUE_SIZE = 100;    // Buffer máximo para estabilidad
        this.MIN_BUFFER_THRESHOLD = 25;  // Mínimo para evitar underruns
        this.OPTIMAL_BUFFER_SIZE = 50;   // Tamaño óptimo para calidad
        
        // --- CONTROL DE CALIDAD DE AUDIO ---
        this.smoothingFactor = 0.82;  // Factor de suavizado para transiciones
        this.lastSampleValue = 0;     // Último valor para interpolación
        this.previousFrame = new Float32Array(128).fill(0);  // Frame anterior para crossfade
        
        // --- CONTROL DE ESTADO ---
        this.underrunCount = 0;
        this.lastUnderrunTime = 0;
        this.processingStartTime = currentTime;
        this.totalProcessedFrames = 0;
        this.expectedNextFrame = 0;
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
                    const processedBuffer = this.preprocessAudioBuffer(event.data.buffer);
                    if (processedBuffer) {
                        this.audioQueue.push(processedBuffer);
                        
                        // Ajuste dinámico de buffer basado en timing
                        const bufferHealth = this.calculateBufferHealth();
                        if (bufferHealth > 1.2) { // Buffer demasiado grande
                            const excessFrames = Math.floor((bufferHealth - 1) * this.OPTIMAL_BUFFER_SIZE);
                            if (excessFrames > 0) {
                                this.audioQueue.splice(0, excessFrames);
                            }
                        }
                    }
                } else {
                    // Mantener buffer fresco descartando frames antiguos
                    while (this.audioQueue.length >= this.MAX_QUEUE_SIZE) {
                        this.audioQueue.shift();
                    }
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
                this.lastSampleValue = 0;
                this.previousFrame.fill(0);
                this.processingStartTime = currentTime;
                this.totalProcessedFrames = 0;
            }
        };
    }

    preprocessAudioBuffer(buffer) {
        try {
            // Convertir buffer a Int16Array si no lo es ya
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            const float32Buffer = new Float32Array(int16Buffer.length);
            
            // Normalización y detección de nivel
            let maxLevel = 0;
            for (let i = 0; i < int16Buffer.length; i++) {
                float32Buffer[i] = int16Buffer[i] / 32768.0;
                maxLevel = Math.max(maxLevel, Math.abs(float32Buffer[i]));
            }
            
            // Aplicar ganancia si el nivel es muy bajo
            if (maxLevel < 0.1) {
                const gain = Math.min(2.0, 0.3 / maxLevel);
                for (let i = 0; i < float32Buffer.length; i++) {
                    float32Buffer[i] *= gain;
                }
            }
            
            return float32Buffer;
        } catch (error) {
            console.error('Error preprocessing buffer:', error);
            return null;
        }
    }

    calculateBufferHealth() {
        const expectedFrames = (currentTime - this.processingStartTime) * this.appSampleRate;
        const actualFrames = this.totalProcessedFrames;
        return this.audioQueue.length / this.OPTIMAL_BUFFER_SIZE;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (this.audioQueue.length < this.MIN_BUFFER_THRESHOLD || !this.isPlaying) {
            if (this.isPlaying && this.audioQueue.length === 0) {
                if (currentTime - this.lastUnderrunTime < 1) {
                    this.underrunCount++;
                    if (this.underrunCount > 2) {
                        this.MIN_BUFFER_THRESHOLD = Math.min(35, this.MIN_BUFFER_THRESHOLD + 2);
                        this.underrunCount = 0;
                    }
                } else {
                    this.underrunCount = 0;
                }
                this.lastUnderrunTime = currentTime;
            }
            
            // Crossfade al silencio
            const fadeOutGain = 0.95;
            for (let i = 0; i < channel.length; i++) {
                this.previousFrame[i] *= fadeOutGain;
                channel[i] = this.previousFrame[i];
            }
            return true;
        }

        const currentBuffer = this.audioQueue.shift();
        if (!currentBuffer) {
            channel.set(this.previousFrame);
            return true;
        }

        try {
            const inputLength = currentBuffer.length;
            const outputLength = channel.length;
            
            // Procesar audio manteniendo la calidad
            for (let i = 0; i < outputLength; i++) {
                // Calcular índice preciso en el buffer de entrada
                const inputIndex = (i * inputLength / outputLength) | 0;
                const nextInputIndex = Math.min(inputIndex + 1, inputLength - 1);
                const fraction = (i * inputLength / outputLength) % 1;
                
                // Interpolación lineal entre muestras
                const currentSample = currentBuffer[inputIndex];
                const nextSample = currentBuffer[nextInputIndex];
                const interpolatedSample = currentSample + (nextSample - currentSample) * fraction;
                
                // Aplicar suavizado con el frame anterior
                const smoothedSample = this.previousFrame[i] * this.smoothingFactor + 
                                     interpolatedSample * (1 - this.smoothingFactor);
                
                channel[i] = smoothedSample;
                this.previousFrame[i] = smoothedSample;
            }
            
            this.totalProcessedFrames += inputLength;
            this.expectedNextFrame = this.totalProcessedFrames;
            
        } catch (error) {
            console.error('Error processing audio frame:', error);
            channel.set(this.previousFrame);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);
