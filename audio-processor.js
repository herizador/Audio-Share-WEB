class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // Configuración básica
        this.MAX_QUEUE_SIZE = 30;       // Buffer más pequeño para menor latencia
        this.MIN_BUFFER_THRESHOLD = 5;   // Umbral bajo para respuesta rápida
        
        // Buffer circular para suavizado
        this.smoothingBuffer = new Float32Array(128);
        this.smoothingBufferIndex = 0;
        
        // Control de volumen simple
        this.currentVolume = 1.0;
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
                    const processedBuffer = this.preprocessBuffer(event.data.buffer);
                    if (processedBuffer) {
                        this.audioQueue.push(processedBuffer);
                    }
                } else {
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
                this.smoothingBuffer.fill(0);
                this.smoothingBufferIndex = 0;
                this.currentVolume = 1.0;
            }
        };
    }

    preprocessBuffer(buffer) {
        try {
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            const float32Buffer = new Float32Array(int16Buffer.length);
            
            // Conversión directa a float32 con normalización simple
            for (let i = 0; i < int16Buffer.length; i++) {
                float32Buffer[i] = int16Buffer[i] / 32768.0;
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
        
        if (!this.isPlaying || this.audioQueue.length < this.MIN_BUFFER_THRESHOLD) {
            channel.fill(0);
            return true;
        }

        const currentBuffer = this.audioQueue.shift();
        if (!currentBuffer) {
            channel.fill(0);
            return true;
        }

        try {
            // Copiar directamente las muestras, aplicando suavizado simple
            const outputLength = Math.min(channel.length, currentBuffer.length);
            for (let i = 0; i < outputLength; i++) {
                // Obtener la muestra actual
                let sample = currentBuffer[i];
                
                // Aplicar suavizado usando el buffer circular
                this.smoothingBuffer[this.smoothingBufferIndex] = sample;
                this.smoothingBufferIndex = (this.smoothingBufferIndex + 1) % this.smoothingBuffer.length;
                
                // Calcular el promedio de las últimas muestras para suavizar
                let sum = 0;
                for (let j = 0; j < 4; j++) {
                    const idx = (this.smoothingBufferIndex - j + this.smoothingBuffer.length) % this.smoothingBuffer.length;
                    sum += this.smoothingBuffer[idx];
                }
                sample = sum / 4;
                
                // Limitar para evitar distorsión
                sample = Math.max(-1, Math.min(1, sample));
                
                // Aplicar a todos los canales
                for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                    output[channelIdx][i] = sample;
                }
            }
            
            // Rellenar con ceros si es necesario
            if (outputLength < channel.length) {
                for (let i = outputLength; i < channel.length; i++) {
                    for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                        output[channelIdx][i] = 0;
                    }
                }
            }
            
        } catch (error) {
            console.error('Error processing audio frame:', error);
            channel.fill(0);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor); 
