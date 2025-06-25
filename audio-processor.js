// audio-processor.js
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // Configuración optimizada para audio natural
        this.MAX_QUEUE_SIZE = 45;       // Balance entre latencia y estabilidad
        this.MIN_BUFFER_THRESHOLD = 10;  // Reducido para menor latencia
        this.smoothingFactor = 0.05;     // Mínimo suavizado para voz natural
        
        // Buffer para transiciones suaves
        this.lastSamples = new Float32Array(256).fill(0);
        this.lastSampleIndex = 0;
        
        // Control de frecuencia de muestreo
        this.inputSampleRate = 16000;  // Sample rate de entrada (app Android)
        this.outputSampleRate = sampleRate; // Sample rate de salida (contexto)
        this.resampleRatio = this.inputSampleRate / this.outputSampleRate;
        
        // Control de volumen dinámico
        this.volumeSmoothing = 0.95;
        this.currentVolume = 1.0;
        
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
                this.currentVolume = 1.0;
            }
        };
    }

    preprocessBuffer(buffer) {
        try {
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            const float32Buffer = new Float32Array(int16Buffer.length);
            
            // Conversión suave a float32
            for (let i = 0; i < int16Buffer.length; i++) {
                float32Buffer[i] = int16Buffer[i] / 32768.0;
            }
            
            return float32Buffer;
        } catch (error) {
            console.error('Error preprocessing buffer:', error);
            return null;
        }
    }

    // Interpolación suave entre muestras
    interpolate(samples, position) {
        const index = Math.floor(position);
        const alpha = position - index;
        
        // Interpolación lineal con límites seguros
        const current = index < samples.length ? samples[index] : 0;
        const next = index + 1 < samples.length ? samples[index + 1] : current;
        
        return current * (1 - alpha) + next * alpha;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (this.audioQueue.length < this.MIN_BUFFER_THRESHOLD || !this.isPlaying) {
            // Fade out natural
            const fadeRate = 0.99;
            for (let i = 0; i < channel.length; i++) {
                this.lastSamples[this.lastSampleIndex] *= fadeRate;
                channel[i] = this.lastSamples[this.lastSampleIndex];
                this.lastSampleIndex = (this.lastSampleIndex + 1) % this.lastSamples.length;
            }
            return true;
        }

        const currentBuffer = this.audioQueue.shift();
        if (!currentBuffer) {
            // Mantener último estado de audio con fade suave
            for (let i = 0; i < channel.length; i++) {
                const lastSample = this.lastSamples[this.lastSampleIndex];
                channel[i] = lastSample * 0.99;
                this.lastSamples[this.lastSampleIndex] = channel[i];
                this.lastSampleIndex = (this.lastSampleIndex + 1) % this.lastSamples.length;
            }
            return true;
        }

        try {
            const inputLength = currentBuffer.length;
            const outputLength = channel.length;
            
            // Calcular volumen promedio del buffer actual
            let sumSquares = 0;
            for (let i = 0; i < inputLength; i++) {
                sumSquares += currentBuffer[i] * currentBuffer[i];
            }
            const rms = Math.sqrt(sumSquares / inputLength);
            
            // Ajustar volumen suavemente
            this.currentVolume = this.currentVolume * this.volumeSmoothing + 
                               rms * (1 - this.volumeSmoothing);
            
            const step = this.resampleRatio;
            
            for (let i = 0; i < outputLength; i++) {
                const inputPosition = i * step;
                
                // Obtener muestra interpolada
                let sample = this.interpolate(currentBuffer, inputPosition);
                
                // Aplicar volumen dinámico
                sample *= (1.0 + this.currentVolume) / 2.0;
                
                // Suavizado mínimo con muestras anteriores
                const lastSample = this.lastSamples[this.lastSampleIndex];
                sample = sample * (1 - this.smoothingFactor) + lastSample * this.smoothingFactor;
                
                // Almacenar y emitir
                this.lastSamples[this.lastSampleIndex] = sample;
                channel[i] = sample;
                
                this.lastSampleIndex = (this.lastSampleIndex + 1) % this.lastSamples.length;
            }
        } catch (error) {
            console.error('Error processing audio frame:', error);
            // Recuperación suave usando último estado
            for (let i = 0; i < channel.length; i++) {
                channel[i] = this.lastSamples[this.lastSampleIndex] * 0.99;
                this.lastSampleIndex = (this.lastSampleIndex + 1) % this.lastSamples.length;
            }
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);
