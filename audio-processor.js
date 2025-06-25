class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // Aumentar buffers para manejar mejor la diferencia de sample rate
        this.MAX_QUEUE_SIZE = 50;        // Buffer más grande para estabilidad
        this.MIN_BUFFER_THRESHOLD = 10;   // Umbral más alto para evitar cortes
        
        // Buffer circular más grande para mejor suavizado
        this.smoothingBuffer = new Float32Array(256);
        this.smoothingBufferIndex = 0;
        
        // Configuración de tasas de muestreo
        this.inputSampleRate = 16000;  // La tasa de muestreo de entrada (Android)
        this.outputSampleRate = sampleRate; // La tasa de muestreo del navegador
        this.resampleRatio = this.outputSampleRate / this.inputSampleRate;
        
        // Estado del último frame para transiciones suaves
        this.lastFrame = new Float32Array(128).fill(0);
        this.lastFrameOffset = 0;
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
                    const processedBuffer = this.preprocessBuffer(event.data.buffer);
                    if (processedBuffer) {
                        this.audioQueue.push(processedBuffer);
                    }
                } else {
                    // Si el buffer está lleno, descartamos algunos frames antiguos
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
                this.lastFrame.fill(0);
                this.lastFrameOffset = 0;
            }
        };
    }

    preprocessBuffer(buffer) {
        try {
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            const float32Buffer = new Float32Array(int16Buffer.length);
            
            // Conversión de Int16 a Float32 con normalización y limitación
            for (let i = 0; i < int16Buffer.length; i++) {
                // Normalizar y aplicar una pequeña compresión
                let sample = int16Buffer[i] / 32768.0;
                // Compresión suave para evitar clipping
                if (sample > 0.8) {
                    sample = 0.8 + (sample - 0.8) * 0.5;
                } else if (sample < -0.8) {
                    sample = -0.8 + (sample + 0.8) * 0.5;
                }
                float32Buffer[i] = sample;
            }
            
            return float32Buffer;
        } catch (error) {
            console.error('Error preprocessing buffer:', error);
            return null;
        }
    }

    // Interpolación cúbica para mejor calidad
    interpolate(y0, y1, y2, y3, mu) {
        const mu2 = mu * mu;
        const a0 = y3 - y2 - y0 + y1;
        const a1 = y0 - y1 - a0;
        const a2 = y2 - y0;
        const a3 = y1;
        
        return a0 * mu * mu2 + a1 * mu2 + a2 * mu + a3;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (!this.isPlaying || this.audioQueue.length < this.MIN_BUFFER_THRESHOLD) {
            // Fade out suave cuando no hay suficientes datos
            const fadeRate = 0.95;
            for (let i = 0; i < channel.length; i++) {
                this.lastFrame[i % this.lastFrame.length] *= fadeRate;
                channel[i] = this.lastFrame[i % this.lastFrame.length];
            }
            return true;
        }

        try {
            let currentBuffer = this.audioQueue[0];
            if (!currentBuffer) {
                // Usar el último frame con fade out si no hay datos
                const fadeRate = 0.95;
                for (let i = 0; i < channel.length; i++) {
                    this.lastFrame[i % this.lastFrame.length] *= fadeRate;
                    channel[i] = this.lastFrame[i % this.lastFrame.length];
                }
                return true;
            }

            const inputLength = currentBuffer.length;
            const outputLength = channel.length;
            let inputOffset = 0;
            
            for (let i = 0; i < outputLength; i++) {
                // Calcular la posición exacta en el buffer de entrada
                const inputPos = i / this.resampleRatio;
                const inputIndex = Math.floor(inputPos);
                
                if (inputIndex >= inputLength - 2) {
                    // Necesitamos más muestras del siguiente buffer
                    if (this.audioQueue.length > 1) {
                        // Combinar el buffer actual con el siguiente
                        const nextBuffer = this.audioQueue[1];
                        const combinedBuffer = new Float32Array(currentBuffer.length + nextBuffer.length);
                        combinedBuffer.set(currentBuffer);
                        combinedBuffer.set(nextBuffer, currentBuffer.length);
                        currentBuffer = combinedBuffer;
                        this.audioQueue.shift(); // Remover el buffer procesado
                    } else {
                        // No hay más buffers, usar interpolación con el último frame
                        break;
                    }
                }
                
                // Obtener 4 puntos para interpolación cúbica
                const y0 = inputIndex > 0 ? currentBuffer[inputIndex - 1] : currentBuffer[0];
                const y1 = currentBuffer[inputIndex];
                const y2 = currentBuffer[inputIndex + 1];
                const y3 = inputIndex + 2 < currentBuffer.length ? currentBuffer[inputIndex + 2] : y2;
                
                // Calcular la fracción para interpolación
                const mu = inputPos - inputIndex;
                
                // Interpolar
                let sample = this.interpolate(y0, y1, y2, y3, mu);
                
                // Aplicar suavizado
                this.smoothingBuffer[this.smoothingBufferIndex] = sample;
                this.smoothingBufferIndex = (this.smoothingBufferIndex + 1) % this.smoothingBuffer.length;
                
                // Promedio móvil ponderado para suavizado
                let sum = 0;
                let weight = 1;
                let totalWeight = 0;
                for (let j = 0; j < 8; j++) {
                    const idx = (this.smoothingBufferIndex - j + this.smoothingBuffer.length) % this.smoothingBuffer.length;
                    sum += this.smoothingBuffer[idx] * weight;
                    totalWeight += weight;
                    weight *= 0.7; // Reducir el peso exponencialmente
                }
                sample = sum / totalWeight;
                
                // Guardar para el próximo frame
                this.lastFrame[i % this.lastFrame.length] = sample;
                
                // Aplicar a todos los canales
                for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                    output[channelIdx][i] = sample;
                }
            }
            
        } catch (error) {
            console.error('Error processing audio frame:', error);
            // En caso de error, usar el último frame con fade out
            const fadeRate = 0.95;
            for (let i = 0; i < channel.length; i++) {
                this.lastFrame[i % this.lastFrame.length] *= fadeRate;
                channel[i] = this.lastFrame[i % this.lastFrame.length];
            }
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor); 
