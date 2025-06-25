class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // Configuración de buffers
        this.MAX_QUEUE_SIZE = 40;
        this.MIN_BUFFER_THRESHOLD = 8;
        
        // Buffer simple para suavizado
        this.lastSample = 0;
        
        // Configuración de tasas de muestreo
        this.inputSampleRate = 16000;  // Android sample rate
        this.outputSampleRate = sampleRate; // Browser sample rate
        this.resampleRatio = this.outputSampleRate / this.inputSampleRate;
        
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
                this.lastSample = 0;
            }
        };
    }

    preprocessBuffer(buffer) {
        try {
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            const float32Buffer = new Float32Array(int16Buffer.length);
            
            // Conversión simple de Int16 a Float32
            for (let i = 0; i < int16Buffer.length; i++) {
                float32Buffer[i] = int16Buffer[i] / 32768.0;
            }
            
            return float32Buffer;
        } catch (error) {
            console.error('Error preprocessing buffer:', error);
            return null;
        }
    }

    // Interpolación lineal simple
    interpolate(a, b, t) {
        return a + (b - a) * t;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (!this.isPlaying || this.audioQueue.length < this.MIN_BUFFER_THRESHOLD) {
            // Fade out suave
            for (let i = 0; i < channel.length; i++) {
                this.lastSample *= 0.95;
                channel[i] = this.lastSample;
            }
            return true;
        }

        try {
            let currentBuffer = this.audioQueue[0];
            if (!currentBuffer) {
                for (let i = 0; i < channel.length; i++) {
                    this.lastSample *= 0.95;
                    channel[i] = this.lastSample;
                }
                return true;
            }

            const inputLength = currentBuffer.length;
            const outputLength = channel.length;
            let needNextBuffer = false;
            
            for (let i = 0; i < outputLength; i++) {
                // Calcular la posición en el buffer de entrada
                const inputPos = i / this.resampleRatio;
                const inputIndex = Math.floor(inputPos);
                
                if (inputIndex >= inputLength - 1) {
                    needNextBuffer = true;
                    break;
                }
                
                // Interpolación lineal simple
                const fraction = inputPos - inputIndex;
                const sample = this.interpolate(
                    currentBuffer[inputIndex],
                    currentBuffer[inputIndex + 1],
                    fraction
                );
                
                // Suavizado muy ligero con la última muestra
                const smoothedSample = sample * 0.85 + this.lastSample * 0.15;
                this.lastSample = smoothedSample;
                
                // Aplicar a todos los canales
                for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                    output[channelIdx][i] = smoothedSample;
                }
            }
            
            // Si procesamos todo el buffer, lo removemos de la cola
            if (needNextBuffer) {
                this.audioQueue.shift();
            }
            
        } catch (error) {
            console.error('Error processing audio frame:', error);
            for (let i = 0; i < channel.length; i++) {
                this.lastSample *= 0.95;
                channel[i] = this.lastSample;
            }
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor); 
