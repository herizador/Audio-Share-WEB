class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // Configuración optimizada para audio de alta calidad
        this.MAX_QUEUE_SIZE = 60;       // Aumentado para mejor estabilidad
        this.MIN_BUFFER_THRESHOLD = 15;  // Ajustado para balance latencia/calidad
        this.smoothingFactor = 0.02;     // Reducido para mayor naturalidad
        
        // Buffer para transiciones suaves
        this.lastSamples = new Float32Array(512).fill(0); // Aumentado para mejor transición
        this.lastSampleIndex = 0;
        
        // Control de frecuencia de muestreo (ajustado a la configuración de Android)
        this.inputSampleRate = 44100;  // Matched with Android's SAMPLE_RATE
        this.outputSampleRate = sampleRate;
        this.resampleRatio = this.inputSampleRate / this.outputSampleRate;
        
        // Control de volumen dinámico
        this.volumeSmoothing = 0.98;    // Más suave
        this.currentVolume = 1.0;
        
        // Control de canales
        this.numChannels = 2;  // Stereo, matching Android's CHANNEL_CONFIG
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
                    const processedBuffer = this.preprocessBuffer(event.data.buffer);
                    if (processedBuffer) {
                        this.audioQueue.push(processedBuffer);
                    }
                } else {
                    // Mantener el buffer lleno pero no descartar demasiado
                    while (this.audioQueue.length >= this.MAX_QUEUE_SIZE) {
                        this.audioQueue.shift();
                    }
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
            
            // Conversión suave a float32 con normalización mejorada
            for (let i = 0; i < int16Buffer.length; i++) {
                // Normalización más precisa para Int16
                float32Buffer[i] = Math.max(-1, Math.min(1, int16Buffer[i] / 32768.0));
            }
            
            return float32Buffer;
        } catch (error) {
            console.error('Error preprocessing buffer:', error);
            return null;
        }
    }

    // Interpolación de alta calidad
    interpolate(samples, position) {
        const index = Math.floor(position);
        const alpha = position - index;
        
        // Interpolación cúbica para mayor suavidad
        const im1 = index > 0 ? samples[index - 1] : samples[index];
        const i0 = samples[index];
        const i1 = index + 1 < samples.length ? samples[index + 1] : i0;
        const i2 = index + 2 < samples.length ? samples[index + 2] : i1;
        
        const c0 = i0;
        const c1 = 0.5 * (i1 - im1);
        const c2 = im1 - 2.5 * i0 + 2 * i1 - 0.5 * i2;
        const c3 = 0.5 * (i2 - im1) + 1.5 * (i0 - i1);
        
        return ((c3 * alpha + c2) * alpha + c1) * alpha + c0;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        
        // Procesar cada canal (stereo)
        for (let channelIdx = 0; channelIdx < Math.min(this.numChannels, output.length); channelIdx++) {
            const channel = output[channelIdx];
            
            if (this.audioQueue.length < this.MIN_BUFFER_THRESHOLD || !this.isPlaying) {
                // Fade out más suave
                const fadeRate = 0.995;
                for (let i = 0; i < channel.length; i++) {
                    this.lastSamples[this.lastSampleIndex] *= fadeRate;
                    channel[i] = this.lastSamples[this.lastSampleIndex];
                    this.lastSampleIndex = (this.lastSampleIndex + 1) % this.lastSamples.length;
                }
                continue;
            }

            const currentBuffer = this.audioQueue[0]; // Solo peek, no shift todavía
            if (!currentBuffer) {
                // Mantener último estado con fade suave
                for (let i = 0; i < channel.length; i++) {
                    const lastSample = this.lastSamples[this.lastSampleIndex];
                    channel[i] = lastSample * 0.995;
                    this.lastSamples[this.lastSampleIndex] = channel[i];
                    this.lastSampleIndex = (this.lastSampleIndex + 1) % this.lastSamples.length;
                }
                continue;
            }

            try {
                const inputLength = currentBuffer.length;
                const outputLength = channel.length;
                
                // Análisis de volumen mejorado
                let sumSquares = 0;
                for (let i = 0; i < inputLength; i++) {
                    sumSquares += currentBuffer[i] * currentBuffer[i];
                }
                const rms = Math.sqrt(sumSquares / inputLength);
                
                // Ajuste de volumen más suave
                const targetVolume = Math.min(1.2, Math.max(0.8, rms * 2));
                this.currentVolume = this.currentVolume * this.volumeSmoothing + 
                                   targetVolume * (1 - this.volumeSmoothing);
                
                let allSamplesProcessed = true;
                const step = this.resampleRatio;
                
                for (let i = 0; i < outputLength; i++) {
                    const inputPosition = i * step;
                    
                    if (inputPosition >= inputLength) {
                        allSamplesProcessed = false;
                        break;
                    }
                    
                    // Obtener muestra con interpolación de alta calidad
                    let sample = this.interpolate(currentBuffer, inputPosition);
                    
                    // Aplicar volumen dinámico suavizado
                    sample *= this.currentVolume;
                    
                    // Suavizado adaptativo
                    const lastSample = this.lastSamples[this.lastSampleIndex];
                    const dynamicSmoothing = Math.min(this.smoothingFactor * 2, 
                                                    Math.abs(sample - lastSample) * 0.1);
                    sample = sample * (1 - dynamicSmoothing) + lastSample * dynamicSmoothing;
                    
                    // Limitar para evitar clipping
                    sample = Math.max(-1, Math.min(1, sample));
                    
                    // Almacenar y emitir
                    this.lastSamples[this.lastSampleIndex] = sample;
                    channel[i] = sample;
                    
                    this.lastSampleIndex = (this.lastSampleIndex + 1) % this.lastSamples.length;
                }
                
                // Solo remover el buffer si se procesó completamente
                if (allSamplesProcessed) {
                    this.audioQueue.shift();
                }
                
            } catch (error) {
                console.error('Error processing audio frame:', error);
                // Recuperación suave usando último estado
                for (let i = 0; i < channel.length; i++) {
                    channel[i] = this.lastSamples[this.lastSampleIndex] * 0.995;
                    this.lastSampleIndex = (this.lastSampleIndex + 1) % this.lastSamples.length;
                }
            }
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor); 
