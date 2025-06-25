// audio-processor.js
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // --- CONFIGURACIÓN BÁSICA ---
        this.MAX_QUEUE_SIZE = 40;     // Buffer mínimo para baja latencia
        this.MIN_BUFFER_THRESHOLD = 10;  // Threshold mínimo
        this.smoothingFactor = 0.5;    // Suavizado mínimo
        
        // Control básico de estado
        this.lastSampleValue = 0;
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
                    // Mantener buffer fresco
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
                this.lastSampleValue = 0;
            }
        };
    }

    preprocessBuffer(buffer) {
        try {
            // Conversión directa sin procesamiento adicional
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            const float32Buffer = new Float32Array(int16Buffer.length);
            const scale = 1.0 / 32768.0;
            
            for (let i = 0; i < int16Buffer.length; i++) {
                float32Buffer[i] = int16Buffer[i] * scale;
            }
            
            return float32Buffer;
        } catch (error) {
            console.error('Error preprocessing buffer:', error);
            return null;
        }
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (this.audioQueue.length < this.MIN_BUFFER_THRESHOLD || !this.isPlaying) {
            if (this.isPlaying && this.audioQueue.length === 0) {
                if (currentTime - this.lastUnderrunTime < 1) {
                    this.underrunCount++;
                    if (this.underrunCount > 2) {
                        this.MIN_BUFFER_THRESHOLD = Math.min(15, this.MIN_BUFFER_THRESHOLD + 1);
                        this.underrunCount = 0;
                    }
                } else {
                    this.underrunCount = 0;
                }
                this.lastUnderrunTime = currentTime;
            }
            
            // Fade out simple
            for (let i = 0; i < channel.length; i++) {
                this.lastSampleValue *= 0.95;
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
            // Procesamiento simple y directo
            const inputLength = currentBuffer.length;
            const outputLength = channel.length;
            
            for (let i = 0; i < outputLength; i++) {
                const inputIndex = Math.floor((i * inputLength) / outputLength);
                const sample = inputIndex < inputLength ? currentBuffer[inputIndex] : 0;
                
                // Suavizado mínimo para evitar pops
                this.lastSampleValue = this.lastSampleValue * this.smoothingFactor + 
                    sample * (1 - this.smoothingFactor);
                
                channel[i] = this.lastSampleValue;
            }
            
        } catch (error) {
            console.error('Error processing audio frame:', error);
            channel.fill(this.lastSampleValue);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);
}
