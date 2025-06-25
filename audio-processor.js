class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // Configuración básica
        this.MAX_QUEUE_SIZE = 30;
        this.MIN_BUFFER_THRESHOLD = 5;
        
        // Buffer para suavizado
        this.smoothingBuffer = new Float32Array(128);
        this.smoothingBufferIndex = 0;
        
        // Configuración de tasas de muestreo
        this.inputSampleRate = 16000;  // La tasa de muestreo de entrada (Android)
        this.outputSampleRate = sampleRate; // La tasa de muestreo del navegador
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
                this.smoothingBuffer.fill(0);
                this.smoothingBufferIndex = 0;
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
            channel.fill(0);
            return true;
        }

        const currentBuffer = this.audioQueue.shift();
        if (!currentBuffer) {
            channel.fill(0);
            return true;
        }

        try {
            // Calcular cuántas muestras necesitamos del buffer de entrada
            const inputLength = currentBuffer.length;
            const outputLength = channel.length;
            
            for (let i = 0; i < outputLength; i++) {
                // Calcular la posición exacta en el buffer de entrada
                const inputPos = i / this.resampleRatio;
                const inputIndex = Math.floor(inputPos);
                const fraction = inputPos - inputIndex;
                
                // Si estamos dentro del buffer de entrada, interpolar
                if (inputIndex < inputLength - 1) {
                    const sample = this.interpolate(
                        currentBuffer[inputIndex],
                        currentBuffer[inputIndex + 1],
                        fraction
                    );
                    
                    // Aplicar suavizado
                    this.smoothingBuffer[this.smoothingBufferIndex] = sample;
                    this.smoothingBufferIndex = (this.smoothingBufferIndex + 1) % this.smoothingBuffer.length;
                    
                    // Promedio móvil simple para suavizar
                    let sum = 0;
                    for (let j = 0; j < 4; j++) {
                        const idx = (this.smoothingBufferIndex - j + this.smoothingBuffer.length) % this.smoothingBuffer.length;
                        sum += this.smoothingBuffer[idx];
                    }
                    const smoothedSample = sum / 4;
                    
                    // Aplicar a todos los canales
                    for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                        output[channelIdx][i] = smoothedSample;
                    }
                } else {
                    // Si nos quedamos sin muestras, rellenar con ceros
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
