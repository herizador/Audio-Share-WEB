// audio-processor.js
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // Configuración para mantener fidelidad y reducir cortes
        this.MAX_QUEUE_SIZE = 50;       // Aumentado para más estabilidad
        this.MIN_BUFFER_THRESHOLD = 12;  // Aumentado para evitar cortes
        this.smoothingFactor = 0.15;     // Reducido para mantener tono original
        
        // Buffer para transiciones suaves
        this.lastSamples = new Float32Array(128).fill(0);
        this.lastSampleIndex = 0;
        
        // Control de frecuencia de muestreo
        this.inputSampleRate = 16000;  // Sample rate de entrada (app Android)
        this.outputSampleRate = sampleRate; // Sample rate de salida (contexto)
        this.resampleRatio = this.inputSampleRate / this.outputSampleRate;
        
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
                this.lastSampleIndex = 0;
            }
        };
    }

    preprocessBuffer(buffer) {
        try {
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            const float32Buffer = new Float32Array(int16Buffer.length);
            
            // Conversión preservando amplitud original
            for (let i = 0; i < int16Buffer.length; i++) {
                float32Buffer[i] = int16Buffer[i] / 32768.0;
            }
            
            return float32Buffer;
        } catch (error) {
            console.error('Error preprocessing buffer:', error);
            return null;
        }
    }

    // Interpolación lineal mejorada
    interpolate(samples, position) {
        const index = Math.floor(position);
        const fraction = position - index;
        const current = samples[index] || 0;
        const next = samples[index + 1] || current;
        return current + (next - current) * fraction;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (this.audioQueue.length < this.MIN_BUFFER_THRESHOLD || !this.isPlaying) {
            // Fade out gradual usando buffer circular
            for (let i = 0; i < channel.length; i++) {
                this.lastSamples[this.lastSampleIndex] *= 0.98;
                channel[i] = this.lastSamples[this.lastSampleIndex];
                this.lastSampleIndex = (this.lastSampleIndex + 1) % this.lastSamples.length;
            }
            return true;
        }

        const currentBuffer = this.audioQueue.shift();
        if (!currentBuffer) {
            // Mantener último estado de audio
            for (let i = 0; i < channel.length; i++) {
                channel[i] = this.lastSamples[this.lastSampleIndex];
                this.lastSampleIndex = (this.lastSampleIndex + 1) % this.lastSamples.length;
            }
            return true;
        }

        try {
            const inputLength = currentBuffer.length;
            const outputLength = channel.length;
            
            // Ajuste de frecuencia de muestreo para mantener tono original
            const step = this.resampleRatio;
            
            for (let i = 0; i < outputLength; i++) {
                const inputPosition = i * step;
                
                // Interpolación para el remuestreo
                let sample = this.interpolate(currentBuffer, inputPosition);
                
                // Suavizado mínimo para mantener naturalidad
                const lastSample = this.lastSamples[this.lastSampleIndex];
                sample = sample * (1 - this.smoothingFactor) + lastSample * this.smoothingFactor;
                
                // Actualizar buffer circular
                this.lastSamples[this.lastSampleIndex] = sample;
                channel[i] = sample;
                
                this.lastSampleIndex = (this.lastSampleIndex + 1) % this.lastSamples.length;
            }
        } catch (error) {
            console.error('Error processing audio frame:', error);
            // Recuperación usando último estado válido
            for (let i = 0; i < channel.length; i++) {
                channel[i] = this.lastSamples[this.lastSampleIndex];
                this.lastSampleIndex = (this.lastSampleIndex + 1) % this.lastSamples.length;
            }
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);
