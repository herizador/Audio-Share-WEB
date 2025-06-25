// audio-processor.js
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // --- VALORES OPTIMIZADOS PARA MEJOR CALIDAD DE AUDIO ---
        this.MAX_QUEUE_SIZE = 100;    // Aumentado para asegurar procesamiento completo
        this.MIN_BUFFER_THRESHOLD = 25;  // Buffer mínimo más alto para estabilidad
        this.OPTIMAL_BUFFER_SIZE = 50;   // Buffer óptimo aumentado para mejor calidad
        this.underrunCount = 0;
        this.lastUnderrunTime = 0;
        this.smoothingFactor = 0.85;  // Suavizado más agresivo
        this.lastSampleValue = 0;
        
        // Variables para control de flujo de audio
        this.sampleRate = 16000;  // Debe coincidir con la app
        this.frameSize = 128;     // Tamaño típico de frame en Web Audio
        this.targetLatency = 0.1; // 100ms de latencia objetivo
        this.bufferTarget = Math.ceil(this.targetLatency * this.sampleRate / this.frameSize);
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
                    // Procesar el buffer antes de agregarlo
                    const processedBuffer = this.preprocessBuffer(event.data.buffer);
                    this.audioQueue.push(processedBuffer);
                    
                    // Ajuste dinámico del buffer basado en la latencia actual
                    const currentLatency = (this.audioQueue.length * this.frameSize) / this.sampleRate;
                    if (currentLatency > this.targetLatency * 1.5) {
                        // Tenemos demasiada latencia, reducir buffer
                        while (this.audioQueue.length > this.bufferTarget) {
                            this.audioQueue.shift();
                        }
                    }
                } else {
                    // Si el buffer está lleno, mantener solo los paquetes más recientes
                    this.audioQueue = this.audioQueue.slice(-this.OPTIMAL_BUFFER_SIZE);
                    this.audioQueue.push(this.preprocessBuffer(event.data.buffer));
                }
            } else if (event.data.type === 'play') {
                this.isPlaying = true;
            } else if (event.data.type === 'pause') {
                this.isPlaying = false;
            } else if (event.data.type === 'stop') {
                this.isPlaying = false;
                this.audioQueue = [];
                this.lastSampleValue = 0;
            }
        };
    }

    preprocessBuffer(buffer) {
        // Convertir el buffer a Int16Array si no lo es ya
        const int16 = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
        // Pre-procesar para tener samples normalizados
        const processed = new Float32Array(int16.length);
        const scale = 1.0 / 32768.0;
        
        for (let i = 0; i < int16.length; i++) {
            processed[i] = int16[i] * scale;
        }
        
        return processed;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (this.audioQueue.length < this.MIN_BUFFER_THRESHOLD || !this.isPlaying) {
            if (this.isPlaying && this.audioQueue.length === 0) {
                if (currentTime - this.lastUnderrunTime < 1) {
                    this.underrunCount++;
                    if (this.underrunCount > 2) {
                        // Aumentar buffer gradualmente
                        this.MIN_BUFFER_THRESHOLD = Math.min(35, 
                            this.MIN_BUFFER_THRESHOLD + 2);
                        this.underrunCount = 0;
                    }
                } else {
                    this.underrunCount = 0;
                }
                this.lastUnderrunTime = currentTime;
            }
            
            // Fade out suave
            for (let i = 0; i < channel.length; i++) {
                this.lastSampleValue *= 0.97;
                channel[i] = this.lastSampleValue;
            }
            return true;
        }

        const currentBuffer = this.audioQueue.shift();
        if (!currentBuffer) {
            channel.fill(this.lastSampleValue);
            return true;
        }

        try {
            // Interpolación suave entre muestras
            const bufferLength = currentBuffer.length;
            const channelLength = channel.length;
            const ratio = bufferLength / channelLength;
            
            for (let i = 0; i < channelLength; i++) {
                const exactIndex = i * ratio;
                const index1 = Math.floor(exactIndex);
                const index2 = Math.min(index1 + 1, bufferLength - 1);
                const fraction = exactIndex - index1;
                
                // Interpolación lineal entre muestras
                const sample1 = currentBuffer[index1] || 0;
                const sample2 = currentBuffer[index2] || 0;
                const interpolatedValue = sample1 + (sample2 - sample1) * fraction;
                
                // Aplicar suavizado
                this.lastSampleValue = this.lastSampleValue * this.smoothingFactor + 
                    interpolatedValue * (1 - this.smoothingFactor);
                
                channel[i] = this.lastSampleValue;
            }
        } catch (e) {
            console.error('Error processing audio:', e);
            channel.fill(this.lastSampleValue);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);
