// audio-processor.js
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // Configuración optimizada para audio natural
        this.MAX_QUEUE_SIZE = 40;      // Reducido para menor latencia
        this.MIN_BUFFER_THRESHOLD = 8;  // Reducido para respuesta más rápida
        this.smoothingFactor = 0.2;     // Suavizado mínimo para mantener naturalidad
        
        // Buffer simple para transiciones
        this.lastSamples = new Float32Array(2).fill(0);
        
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
                this.lastSamples.fill(0);
            }
        };
    }

    preprocessBuffer(buffer) {
        try {
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            const float32Buffer = new Float32Array(int16Buffer.length);
            
            // Conversión directa manteniendo la fidelidad
            for (let i = 0; i < int16Buffer.length; i++) {
                float32Buffer[i] = int16Buffer[i] / 32768.0;
            }
            
            return float32Buffer;
        } catch (error) {
            console.error('Error preprocessing buffer:', error);
            return null;
        }
    }

    // Interpolación lineal simple para suavizar transiciones
    interpolate(a, b, t) {
        return a + (b - a) * t;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (this.audioQueue.length < this.MIN_BUFFER_THRESHOLD || !this.isPlaying) {
            // Fade out natural
            const fadeOut = 0.95;
            for (let i = 0; i < channel.length; i++) {
                this.lastSamples[0] *= fadeOut;
                channel[i] = this.lastSamples[0];
            }
            return true;
        }

        const currentBuffer = this.audioQueue.shift();
        if (!currentBuffer) {
            channel.fill(this.lastSamples[0]);
            return true;
        }

        try {
            const samplesPerFrame = channel.length;
            const inputLength = currentBuffer.length;
            const ratio = inputLength / samplesPerFrame;
            
            for (let i = 0; i < samplesPerFrame; i++) {
                const exactIndex = i * ratio;
                const index = Math.floor(exactIndex);
                const fraction = exactIndex - index;
                
                // Obtener muestras para interpolación
                const currentSample = index < inputLength ? currentBuffer[index] : this.lastSamples[0];
                const nextSample = index + 1 < inputLength ? currentBuffer[index + 1] : currentSample;
                
                // Interpolación simple para suavizar
                let sample = this.interpolate(currentSample, nextSample, fraction);
                
                // Suavizado mínimo para mantener naturalidad
                sample = sample * (1 - this.smoothingFactor) + this.lastSamples[0] * this.smoothingFactor;
                
                // Actualizar buffer de transición
                this.lastSamples[1] = this.lastSamples[0];
                this.lastSamples[0] = sample;
                
                channel[i] = sample;
            }
        } catch (error) {
            console.error('Error processing audio frame:', error);
            channel.fill(this.lastSamples[0]);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);
