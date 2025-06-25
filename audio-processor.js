// audio-processor.js
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // --- VALORES OPTIMIZADOS PARA COMPATIBILIDAD CON APP ---
        this.MAX_QUEUE_SIZE = 75;     // Aumentado para mejor buffer con la app
        this.MIN_BUFFER_THRESHOLD = 20;  // Aumentado para evitar underruns
        this.OPTIMAL_BUFFER_SIZE = 35;   // Ajustado para balance entre latencia y estabilidad
        this.underrunCount = 0;
        this.lastUnderrunTime = 0;
        this.smoothingFactor = 0.75;  // Reducido para menor distorsión
        this.lastSampleValue = 0;     // Para interpolación
        
        // Control de tiempo y tasa de procesamiento
        this.lastProcessTime = 0;
        this.processInterval = 1000 / 48; // ~48 frames por segundo
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                // Verificar si el buffer está dentro de límites razonables
                if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
                    this.audioQueue.push(event.data.buffer);
                    
                    // Ajuste dinámico más suave del buffer
                    if (this.audioQueue.length > this.OPTIMAL_BUFFER_SIZE) {
                        this.MIN_BUFFER_THRESHOLD = Math.max(15, 
                            this.MIN_BUFFER_THRESHOLD - 0.5);
                    }
                } else {
                    // Mantener un buffer deslizante más eficiente
                    const excessBuffers = this.audioQueue.length - this.OPTIMAL_BUFFER_SIZE;
                    if (excessBuffers > 5) {
                        this.audioQueue.splice(0, excessBuffers);
                    } else {
                        this.audioQueue.shift();
                    }
                    this.audioQueue.push(event.data.buffer);
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

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        // Control de tasa de procesamiento
        const currentTime = performance.now();
        const timeSinceLastProcess = currentTime - this.lastProcessTime;
        
        if (timeSinceLastProcess < this.processInterval) {
            // Reutilizar último frame para evitar procesamiento excesivo
            channel.fill(this.lastSampleValue);
            return true;
        }
        
        this.lastProcessTime = currentTime;

        if (this.audioQueue.length < this.MIN_BUFFER_THRESHOLD || !this.isPlaying) {
            if (this.isPlaying && this.audioQueue.length === 0) {
                const now = currentTime;
                if (now - this.lastUnderrunTime < 1000) {
                    this.underrunCount++;
                    if (this.underrunCount > 2) {
                        // Incremento más gradual del buffer
                        this.MIN_BUFFER_THRESHOLD = Math.min(40, 
                            this.MIN_BUFFER_THRESHOLD + 1);
                        console.log('Ajustando buffer threshold:', this.MIN_BUFFER_THRESHOLD);
                        this.underrunCount = 0;
                    }
                } else {
                    this.underrunCount = 0;
                }
                this.lastUnderrunTime = now;
            }
            
            // Fade out suave al silencio
            for (let i = 0; i < channel.length; i++) {
                this.lastSampleValue *= 0.95;
                channel[i] = this.lastSampleValue;
            }
            return true;
        }

        const rawBuffer = this.audioQueue.shift();
        if (!rawBuffer) {
            channel.fill(this.lastSampleValue);
            return true;
        }

        try {
            const int16 = new Int16Array(rawBuffer);
            const scale = 1.0 / 32768.0;
            
            // Interpolación y suavizado mejorado
            for (let i = 0; i < channel.length; i++) {
                if (i < int16.length) {
                    const targetValue = int16[i] * scale;
                    this.lastSampleValue = this.lastSampleValue * this.smoothingFactor + 
                        targetValue * (1 - this.smoothingFactor);
                    channel[i] = this.lastSampleValue;
                } else {
                    // Extrapolar suavemente si faltan muestras
                    this.lastSampleValue *= 0.98;
                    channel[i] = this.lastSampleValue;
                }
            }
        } catch (e) {
            console.error('Error processing audio:', e);
            channel.fill(this.lastSampleValue);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);
