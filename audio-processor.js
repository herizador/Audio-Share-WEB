class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // Configuración de buffers
        this.MAX_QUEUE_SIZE = 32;
        this.MIN_BUFFER_THRESHOLD = 4;
        
        // Tasas de muestreo y configuración
        this.inputSampleRate = 16000;  // Android sample rate
        this.outputSampleRate = sampleRate; // Browser sample rate (48000)
        this.resampleRatio = this.outputSampleRate / this.inputSampleRate;
        
        // Buffer para interpolación
        this.previousSample = 0;
        this.currentSample = 0;
        
        console.log(`Audio processor initialized - Input: ${this.inputSampleRate}Hz, Output: ${this.outputSampleRate}Hz, Ratio: ${this.resampleRatio}`);
        
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
                this.previousSample = 0;
                this.currentSample = 0;
            }
        };
    }

    preprocessBuffer(buffer) {
        try {
            // Convertir el buffer a Int16Array si no lo es ya
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            const float32Buffer = new Float32Array(int16Buffer.length);
            
            // Normalizar a rango -1.0 a 1.0 con un factor de escala más conservador
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

    // Interpolación lineal mejorada
    lerp(a, b, t) {
        return a + (b - a) * Math.max(0, Math.min(1, t));
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (!this.isPlaying || this.audioQueue.length < this.MIN_BUFFER_THRESHOLD) {
            channel.fill(0);
            return true;
        }

        try {
            let currentBuffer = this.audioQueue[0];
            if (!currentBuffer) {
                channel.fill(0);
                return true;
            }

            let inputIndex = 0;
            let accumulatedTime = 0;
            
            // Procesar cada muestra del buffer de salida
            for (let i = 0; i < channel.length; i++) {
                // Calcular la posición exacta en el tiempo de entrada
                accumulatedTime = i / this.resampleRatio;
                inputIndex = Math.floor(accumulatedTime);
                
                if (inputIndex >= currentBuffer.length) {
                    // Necesitamos el siguiente buffer
                    this.previousSample = currentBuffer[currentBuffer.length - 1];
                    this.audioQueue.shift();
                    currentBuffer = this.audioQueue[0];
                    if (!currentBuffer) {
                        // No hay más datos, rellenar con ceros
                        while (i < channel.length) {
                            channel[i] = 0;
                            i++;
                        }
                        break;
                    }
                    inputIndex = 0;
                    accumulatedTime = 0;
                }

                // Obtener las muestras para interpolar
                const currentSample = currentBuffer[inputIndex];
                const nextSample = inputIndex + 1 < currentBuffer.length ? 
                    currentBuffer[inputIndex + 1] : 
                    (this.audioQueue[1] ? this.audioQueue[1][0] : currentSample);

                // Calcular la fracción para interpolación
                const fraction = accumulatedTime - inputIndex;
                
                // Interpolar y aplicar
                const interpolatedSample = this.lerp(currentSample, nextSample, fraction);
                
                // Aplicar a todos los canales de salida
                for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                    output[channelIdx][i] = interpolatedSample;
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
