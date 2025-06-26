class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // Configuración de buffers
        this.MAX_QUEUE_SIZE = 12;     // Buffer más pequeño para menor latencia
        this.MIN_BUFFER_THRESHOLD = 2; // Comenzar a reproducir más rápido
        
        // Último valor para suavizado
        this.lastSample = 0;
        
        // Configuración de tasas de muestreo
        this.inputSampleRate = 16000;  // Android sample rate
        this.outputSampleRate = sampleRate; // Browser sample rate (48000)
        
        // Para 48000/16000 = 3, necesitamos repetir cada muestra 3 veces
        this.upsampleFactor = Math.round(this.outputSampleRate / this.inputSampleRate);
        
        console.log(`Input rate: ${this.inputSampleRate}, Output rate: ${this.outputSampleRate}, Upsampling factor: ${this.upsampleFactor}`);
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
                    const processedBuffer = this.preprocessBuffer(event.data.buffer);
                    if (processedBuffer) {
                        this.audioQueue.push(processedBuffer);
                    }
                } else {
                    // Si el buffer está lleno, descartar el más antiguo
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
                this.lastSample = 0;
            }
        };
    }

    preprocessBuffer(buffer) {
        try {
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            const float32Buffer = new Float32Array(int16Buffer.length);
            
            // Conversión de Int16 a Float32 (-1.0 a 1.0)
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

        try {
            const currentBuffer = this.audioQueue[0];
            if (!currentBuffer) {
                channel.fill(0);
                return true;
            }

            let outputIndex = 0;
            let inputIndex = 0;
            
            // Procesar el buffer actual repitiendo cada muestra según el factor de upsampling
            while (outputIndex < channel.length && inputIndex < currentBuffer.length) {
                const sample = currentBuffer[inputIndex];
                
                // Repetir cada muestra según el factor de upsampling
                for (let repeat = 0; repeat < this.upsampleFactor && outputIndex < channel.length; repeat++) {
                    // Aplicar a todos los canales de salida
                    for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                        output[channelIdx][outputIndex] = sample;
                    }
                    outputIndex++;
                }
                
                inputIndex++;
            }
            
            // Si hemos usado todo el buffer de entrada, lo removemos de la cola
            if (inputIndex >= currentBuffer.length) {
                this.audioQueue.shift();
            }
            
            // Rellenar con ceros si quedan muestras sin procesar
            while (outputIndex < channel.length) {
                for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                    output[channelIdx][outputIndex] = 0;
                }
                outputIndex++;
            }
            
        } catch (error) {
            console.error('Error processing audio frame:', error);
            channel.fill(0);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor); 
