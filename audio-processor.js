// audio-processor.js
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // --- CONFIGURACIÓN BÁSICA ---
        this.MAX_QUEUE_SIZE = 60;          // Aumentado para más estabilidad
        this.MIN_BUFFER_THRESHOLD = 15;    // Aumentado para evitar cortes
        this.smoothingFactor = 0.85;       // Más suavizado
        
        // Buffer para interpolación
        this.previousSamples = new Float32Array(4).fill(0);
        this.sampleIndex = 0;
        
        // Control de estado
        this.underrunCount = 0;
        this.lastUnderrunTime = 0;
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
                    const processedBuffer = this.preprocessBuffer(event.data.buffer);
                    if (processedBuffer) {
                        this.audioQueue.push(processedBuffer);
                    }
                } else {
                    this.audioQueue.shift();
                    const processedBuffer = this.preprocessBuffer(event.data.buffer);
                    if (processedBuffer) {
                        this.audioQueue.push(processedBuffer);
                    }
                }
            } else if (event.data.type === 'play') {
                this.isPlaying = true;
            } else if (event.data.type === 'pause') {
                this.isPlaying = false;
            } else if (event.data.type === 'stop') {
                this.isPlaying = false;
                this.audioQueue = [];
                this.previousSamples.fill(0);
                this.sampleIndex = 0;
            }
        };
    }

    preprocessBuffer(buffer) {
        try {
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            const float32Buffer = new Float32Array(int16Buffer.length);
            
            for (let i = 0; i < int16Buffer.length; i++) {
                float32Buffer[i] = int16Buffer[i] / 32768.0;
            }
            
            return float32Buffer;
        } catch (error) {
            console.error('Error preprocessing buffer:', error);
            return null;
        }
    }

    // Interpolación cúbica para suavizar el audio
    interpolateCubic(x0, x1, x2, x3, t) {
        const t2 = t * t;
        const t3 = t2 * t;
        
        const a0 = x3 - x2 - x0 + x1;
        const a1 = x0 - x1 - a0;
        const a2 = x2 - x0;
        const a3 = x1;
        
        return a0 * t3 + a1 * t2 + a2 * t + a3;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (this.audioQueue.length < this.MIN_BUFFER_THRESHOLD || !this.isPlaying) {
            if (this.isPlaying && this.audioQueue.length === 0) {
                if (currentTime - this.lastUnderrunTime < 1) {
                    this.underrunCount++;
                    if (this.underrunCount > 2) {
                        this.MIN_BUFFER_THRESHOLD = Math.min(20, this.MIN_BUFFER_THRESHOLD + 2);
                        this.underrunCount = 0;
                    }
                } else {
                    this.underrunCount = 0;
                }
                this.lastUnderrunTime = currentTime;
            }
            
            // Fade out suave usando las muestras anteriores
            for (let i = 0; i < channel.length; i++) {
                this.previousSamples[this.sampleIndex % 4] *= 0.95;
                channel[i] = this.previousSamples[this.sampleIndex % 4];
                this.sampleIndex++;
            }
            return true;
        }

        const currentBuffer = this.audioQueue.shift();
        if (!currentBuffer) {
            // Mantener el último estado de audio
            const lastSample = this.previousSamples[(this.sampleIndex - 1) % 4];
            channel.fill(lastSample);
            return true;
        }

        try {
            const samplesPerFrame = channel.length;
            const inputLength = currentBuffer.length;
            const skipRatio = inputLength / samplesPerFrame;
            
            for (let i = 0; i < samplesPerFrame; i++) {
                const position = i * skipRatio;
                const index = Math.floor(position);
                const fraction = position - index;
                
                // Obtener 4 puntos para interpolación
                const x0 = index > 0 ? currentBuffer[index - 1] : this.previousSamples[3];
                const x1 = currentBuffer[index];
                const x2 = index + 1 < inputLength ? currentBuffer[index + 1] : x1;
                const x3 = index + 2 < inputLength ? currentBuffer[index + 2] : x2;
                
                // Aplicar interpolación cúbica
                let sample = this.interpolateCubic(x0, x1, x2, x3, fraction);
                
                // Suavizado adicional
                sample = sample * (1 - this.smoothingFactor) + 
                        this.previousSamples[this.sampleIndex % 4] * this.smoothingFactor;
                
                // Guardar muestra para siguiente iteración
                this.previousSamples[this.sampleIndex % 4] = sample;
                channel[i] = sample;
                this.sampleIndex++;
            }
            
        } catch (error) {
            console.error('Error processing audio frame:', error);
            const lastSample = this.previousSamples[(this.sampleIndex - 1) % 4];
            channel.fill(lastSample);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);
