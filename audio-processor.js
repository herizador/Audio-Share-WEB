// audio-processor.js
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // --- VALORES OPTIMIZADOS PARA MEJOR FLUIDEZ ---
        this.MAX_QUEUE_SIZE = 35;    // Reducido para menor latencia
        this.MIN_BUFFER_THRESHOLD = 10;  // Reducido para menor latencia
        this.OPTIMAL_BUFFER_SIZE = 20;   // Tamaño óptimo del buffer
        this.underrunCount = 0;
        this.lastUnderrunTime = 0;
        this.smoothingFactor = 0.75;  // Suavizado más agresivo
        this.lastSample = 0;          // Para interpolación
        this.processingStartTime = currentTime;
        this.totalSamplesProcessed = 0;
        
        // Control de calidad
        this.averageBufferSize = 0;
        this.bufferSizeHistory = [];
        this.HISTORY_SIZE = 50;
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
                    this.audioQueue.push(event.data.buffer);
                    
                    // Ajuste dinámico del buffer basado en historial
                    this.updateBufferStats();
                    if (this.averageBufferSize > this.OPTIMAL_BUFFER_SIZE) {
                        this.MIN_BUFFER_THRESHOLD = Math.max(8, this.MIN_BUFFER_THRESHOLD - 1);
                    }
                } else {
                    // Buffer deslizante con interpolación
                    this.audioQueue.shift();
                    this.audioQueue.push(event.data.buffer);
                }
            } else if (event.data.type === 'play') {
                this.isPlaying = true;
                this.processingStartTime = currentTime;
                this.totalSamplesProcessed = 0;
            } else if (event.data.type === 'pause') {
                this.isPlaying = false;
            } else if (event.data.type === 'stop') {
                this.isPlaying = false;
                this.audioQueue = [];
                this.resetStats();
            } else if (event.data.type === 'adjustBuffer') {
                if (event.data.increase) {
                    this.MIN_BUFFER_THRESHOLD = Math.min(25, this.MIN_BUFFER_THRESHOLD + 2);
                } else {
                    this.MIN_BUFFER_THRESHOLD = Math.max(8, this.MIN_BUFFER_THRESHOLD - 1);
                }
            }
        };
    }

    updateBufferStats() {
        this.bufferSizeHistory.push(this.audioQueue.length);
        if (this.bufferSizeHistory.length > this.HISTORY_SIZE) {
            this.bufferSizeHistory.shift();
        }
        this.averageBufferSize = this.bufferSizeHistory.reduce((a, b) => a + b, 0) / this.bufferSizeHistory.length;
    }

    resetStats() {
        this.bufferSizeHistory = [];
        this.averageBufferSize = 0;
        this.underrunCount = 0;
        this.lastUnderrunTime = 0;
        this.lastSample = 0;
        this.processingStartTime = currentTime;
        this.totalSamplesProcessed = 0;
    }

    interpolateSamples(prev, next, factor) {
        return prev + (next - prev) * factor;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        // Detectar underruns y ajustar buffer
        if (this.audioQueue.length < this.MIN_BUFFER_THRESHOLD || !this.isPlaying) {
            if (this.isPlaying && this.audioQueue.length === 0) {
                const now = currentTime;
                if (now - this.lastUnderrunTime < 1) {
                    this.underrunCount++;
                    if (this.underrunCount > 2) {
                        // Notificar underrun para ajuste de buffer
                        this.port.postMessage({ type: 'underrun' });
                        this.underrunCount = 0;
                    }
                } else {
                    this.underrunCount = 0;
                }
                this.lastUnderrunTime = now;
            }
            
            // Fade out suave en lugar de silencio abrupto
            for (let i = 0; i < channel.length; i++) {
                channel[i] = this.lastSample * Math.max(0, 1 - i/channel.length);
            }
            this.lastSample = 0;
            return true;
        }

        const rawBuffer = this.audioQueue.shift();
        if (!rawBuffer) {
            channel.fill(0);
            return true;
        }

        try {
            const int16 = new Int16Array(rawBuffer);
            const scale = 1.0 / 32768.0;
            
            // Procesamiento de audio mejorado con interpolación
            let prevSample = this.lastSample;
            for (let i = 0; i < channel.length; i++) {
                if (i < int16.length) {
                    const currentSample = int16[i] * scale;
                    // Aplicar suavizado e interpolación
                    channel[i] = this.interpolateSamples(
                        prevSample,
                        currentSample,
                        this.smoothingFactor
                    );
                    prevSample = channel[i];
                } else {
                    // Fade out suave al final del buffer
                    channel[i] = prevSample * Math.max(0, 1 - (i - int16.length)/128);
                }
            }
            this.lastSample = prevSample;
            
            // Actualizar estadísticas
            this.totalSamplesProcessed += channel.length;
            
            // Ajuste dinámico del factor de suavizado basado en la calidad
            const timeElapsed = currentTime - this.processingStartTime;
            if (timeElapsed > 1) {
                const samplesPerSecond = this.totalSamplesProcessed / timeElapsed;
                this.smoothingFactor = Math.min(0.85, Math.max(0.65, 
                    0.75 + (samplesPerSecond - sampleRate) / (2 * sampleRate)
                ));
            }
            
        } catch (e) {
            console.error('Error processing audio:', e);
            channel.fill(0);
            this.lastSample = 0;
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);