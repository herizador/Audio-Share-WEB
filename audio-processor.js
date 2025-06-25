// audio-processor.js
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // --- VALORES OPTIMIZADOS PARA MEJOR FLUIDEZ ---
        this.MAX_QUEUE_SIZE = 50;    // Reducido para menor latencia
        this.MIN_BUFFER_THRESHOLD = 15;  // Reducido pero manteniendo estabilidad
        this.OPTIMAL_BUFFER_SIZE = 25;   // Tamaño óptimo del buffer
        this.underrunCount = 0;
        this.lastUnderrunTime = 0;
        this.smoothingFactor = 0.85;  // Factor de suavizado para transiciones

        console.log('AudioStreamProcessor initialized with new buffer settings');

        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
                    this.audioQueue.push(event.data.buffer);
                    
                    // Ajuste dinámico del buffer
                    if (this.audioQueue.length > this.OPTIMAL_BUFFER_SIZE) {
                        this.MIN_BUFFER_THRESHOLD = Math.max(10, this.MIN_BUFFER_THRESHOLD - 1);
                    }
                } else {
                    // Si la cola está llena, mantenemos un buffer deslizante
                    this.audioQueue.shift();
                    this.audioQueue.push(event.data.buffer);
                }
            } else if (event.data.type === 'play') {
                this.isPlaying = true;
                console.log('AudioWorklet: Play command received');
            } else if (event.data.type === 'pause') {
                this.isPlaying = false;
                console.log('AudioWorklet: Pause command received');
            } else if (event.data.type === 'stop') {
                this.isPlaying = false;
                this.audioQueue = [];
                console.log('AudioWorklet: Stop command received, queue cleared');
            }
        };
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (this.audioQueue.length < this.MIN_BUFFER_THRESHOLD || !this.isPlaying) {
            if (this.isPlaying && this.audioQueue.length === 0) {
                const now = currentTime;
                if (now - this.lastUnderrunTime < 1) {
                    this.underrunCount++;
                    if (this.underrunCount > 3) {
                        this.MIN_BUFFER_THRESHOLD = Math.min(30, this.MIN_BUFFER_THRESHOLD + 2);
                        this.underrunCount = 0;
                    }
                } else {
                    this.underrunCount = 0;
                }
                this.lastUnderrunTime = now;
            }
            
            // Silencio suave en lugar de corte abrupto
            channel.fill(0);
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
            
            // Aplicar suavizado en las transiciones
            for (let i = 0; i < channel.length; i++) {
                const newSample = (i < int16.length) ? int16[i] * scale : 0;
                channel[i] = i > 0 ? 
                    this.smoothingFactor * channel[i-1] + (1 - this.smoothingFactor) * newSample : 
                    newSample;
            }
        } catch (e) {
            console.error('Error processing audio:', e);
            channel.fill(0);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);