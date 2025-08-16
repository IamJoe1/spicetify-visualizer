import React, { useCallback, useContext, useMemo } from "react";
import AnimatedCanvas from "../AnimatedCanvas";
import {
	sampleAmplitudeMovingAverage,
	decibelsToAmplitude,
	mapLinear,
	integrateLinearSegment,
	sampleAccumulatedIntegral
} from "../../utils";
import {
	vertexShader as PARTICLE_VERT_SHADER,
	fragmentShader as PARTICLE_FRAG_SHADER
} from "../../shaders/ncs-visualizer/particle";
import { vertexShader as DOT_VERT_SHADER, fragmentShader as DOT_FRAG_SHADER } from "../../shaders/ncs-visualizer/dot";
import { vertexShader as BLUR_VERT_SHADER, fragmentShader as BLUR_FRAG_SHADER } from "../../shaders/ncs-visualizer/blur";
import {
	vertexShader as FINALIZE_VERT_SHADER,
	fragmentShader as FINALIZE_FRAG_SHADER
} from "../../shaders/ncs-visualizer/finalize";
import { ErrorHandlerContext, ErrorRecovery } from "../../error";
import { RendererProps } from "../../app";

// Utility function to convert RGB to HSV
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
	r /= 255;
	g /= 255;
	b /= 255;
	
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const diff = max - min;
	
	let h = 0;
	if (diff !== 0) {
		if (max === r) h = ((g - b) / diff) % 6;
		else if (max === g) h = (b - r) / diff + 2;
		else h = (r - g) / diff + 4;
	}
	h = h * 60;
	if (h < 0) h += 360;
	
	const s = max === 0 ? 0 : diff / max;
	const v = max;
	
	return [h / 360, s, v];
}

// Utility function to convert HSV to RGB
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
	h *= 360;
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	
	let r = 0, g = 0, b = 0;
	if (0 <= h && h < 60) [r, g, b] = [c, x, 0];
	else if (60 <= h && h < 120) [r, g, b] = [x, c, 0];
	else if (120 <= h && h < 180) [r, g, b] = [0, c, x];
	else if (180 <= h && h < 240) [r, g, b] = [0, x, c];
	else if (240 <= h && h < 300) [r, g, b] = [x, 0, c];
	else if (300 <= h && h < 360) [r, g, b] = [c, 0, x];
	
	return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// Generate complementary and accent colors from base theme color
function generateColorPalette(baseColor: Spicetify.Color): {
	base: [number, number, number];
	secondary: [number, number, number];
	accent: [number, number, number];
} {
	const [h, s, v] = rgbToHsv(baseColor.rgb.r, baseColor.rgb.g, baseColor.rgb.b);
	
	// Create secondary color with hue shift and slightly different saturation
	const secondaryHue = (h + 0.25) % 1; // 90 degree hue shift
	const secondarySat = Math.min(1, s * 1.2); // Boost saturation
	const secondaryVal = Math.min(1, v * 0.9); // Slightly darker
	const secondary = hsvToRgb(secondaryHue, secondarySat, secondaryVal);
	
	// Create accent color with complementary hue
	const accentHue = (h + 0.5) % 1; // 180 degree hue shift (complementary)
	const accentSat = Math.min(1, s * 1.4); // More saturated
	const accentVal = Math.min(1, v * 1.1); // Slightly brighter
	const accent = hsvToRgb(accentHue, accentSat, accentVal);
	
	return {
		base: [baseColor.rgb.r, baseColor.rgb.g, baseColor.rgb.b],
		secondary,
		accent
	};
}

type CanvasData = {
	themeColor: Spicetify.Color;
	seed: number;
	amplitudeCurve: CurveEntry[];
};

type RendererState =
	| {
			isError: true;
	  }
	| {
			isError: false;
			particleShader: WebGLProgram;
			dotShader: WebGLProgram;
			blurShader: WebGLProgram;
			finalizeShader: WebGLProgram;
			viewportSize: number;
			particleTextureSize: number;

			inPositionLoc: number;
			inPositionLocDot: number;
			inPositionLocBlur: number;
			inPositionLocFinalize: number;

			uNoiseOffsetLoc: WebGLUniformLocation;
			uAmplitudeLoc: WebGLUniformLocation;
			uSeedLoc: WebGLUniformLocation;
			uDotSpacingLoc: WebGLUniformLocation;
			uDotOffsetLoc: WebGLUniformLocation;
			uSphereRadiusLoc: WebGLUniformLocation;
			uFeatherLoc: WebGLUniformLocation;
			uNoiseFrequencyLoc: WebGLUniformLocation;
			uNoiseAmplitudeLoc: WebGLUniformLocation;

			uDotCountLoc: WebGLUniformLocation;
			uDotRadiusLoc: WebGLUniformLocation;
			uDotRadiusPXLoc: WebGLUniformLocation;
			uParticleTextureLoc: WebGLUniformLocation;

			uBlurRadiusLoc: WebGLUniformLocation;
			uBlurDirectionLoc: WebGLUniformLocation;
			uBlurInputTextureLoc: WebGLUniformLocation;

			uBaseColorLoc: WebGLUniformLocation;
			uSecondaryColorLoc: WebGLUniformLocation;
			uAccentColorLoc: WebGLUniformLocation;
			uTimeLoc: WebGLUniformLocation;
			uAmplitudeFinalizeLoc: WebGLUniformLocation;
			uColorCycleSpeedLoc: WebGLUniformLocation;
			uColorMixIntensityLoc: WebGLUniformLocation;
			uBlurredTextureLoc: WebGLUniformLocation;
			uOriginalTextureLoc: WebGLUniformLocation;

			quadBuffer: WebGLBuffer;

			particleFramebuffer: WebGLFramebuffer;
			particleTexture: WebGLTexture;
			dotFramebuffer: WebGLFramebuffer;
			dotTexture: WebGLTexture;
			blurXFramebuffer: WebGLFramebuffer;
			blurXTexture: WebGLTexture;
			blurYFramebuffer: WebGLFramebuffer;
			blurYTexture: WebGLTexture;
	  };

export default function NCSVisualizer(props: RendererProps) {
	const onError = useContext(ErrorHandlerContext);

	const amplitudeCurve = useMemo(() => {
		if (!props.audioAnalysis) return [{ x: 0, y: 0 }];

		const segments = props.audioAnalysis.segments;

		const amplitudeCurve: CurveEntry[] = segments.flatMap(segment =>
			segment.loudness_max_time
				? [
						{ x: segment.start, y: decibelsToAmplitude(segment.loudness_start) },
						{ x: segment.start + segment.loudness_max_time, y: decibelsToAmplitude(segment.loudness_max) }
					]
				: [{ x: segment.start, y: decibelsToAmplitude(segment.loudness_start) }]
		);

		if (segments.length) {
			amplitudeCurve[0].accumulatedIntegral = 0;
			for (let i = 1; i < amplitudeCurve.length; i++) {
				const prev = amplitudeCurve[i - 1];
				const curr = amplitudeCurve[i];
				curr.accumulatedIntegral = (prev.accumulatedIntegral ?? 0) + integrateLinearSegment(prev, curr);
			}

			const lastSegment = segments[segments.length - 1];
			amplitudeCurve.push({
				x: lastSegment.start + lastSegment.duration,
				y: decibelsToAmplitude(lastSegment.loudness_end)
			});
		}

		return amplitudeCurve;
	}, [props.audioAnalysis]);

	const seed = props.audioAnalysis?.meta.timestamp ?? 0;

	const onInit = useCallback((gl: WebGL2RenderingContext | null): RendererState => {
		if (!gl) {
			onError("Error: WebGL2 is not supported", ErrorRecovery.NONE);
			return { isError: true };
		}

		if (!gl.getExtension("EXT_color_buffer_float")) {
			onError(`Error: Rendering to floating-point textures is not supported`, ErrorRecovery.NONE);
			return { isError: true };
		}

		const createShader = (type: number, source: string, name: string) => {
			const shader = gl.createShader(type)!;
			gl.shaderSource(shader, source);
			gl.compileShader(shader);

			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
				const msg = `Error: Failed to compile '${name}' shader`;
				const log = gl.getShaderInfoLog(shader);
				console.error(`[Visualizer] ${msg}`, log);

				onError(msg, ErrorRecovery.NONE);
				return null;
			}

			return shader;
		};

		const createProgram = (vertShader: WebGLShader, fragShader: WebGLShader, name: string) => {
			const shader = gl.createProgram()!;
			gl.attachShader(shader, vertShader);
			gl.attachShader(shader, fragShader);
			gl.linkProgram(shader);

			if (!gl.getProgramParameter(shader, gl.LINK_STATUS) && !gl.isContextLost()) {
				const msg = `Error: Failed to link '${name}' shader`;
				const log = gl.getProgramInfoLog(shader);
				console.error(`[Visualizer] ${msg}`, log);

				onError(msg, ErrorRecovery.NONE);
				return null;
			}

			return shader;
		};

		const createFramebuffer = (filter: number) => {
			const framebuffer = gl.createFramebuffer()!;
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

			const texture = gl.createTexture()!;
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

			return { framebuffer, texture };
		};

		const particleVertShader = createShader(gl.VERTEX_SHADER, PARTICLE_VERT_SHADER, "particle vertex");
		if (!particleVertShader) return { isError: true };
		const particleFragShader = createShader(gl.FRAGMENT_SHADER, PARTICLE_FRAG_SHADER, "particle fragment");
		if (!particleFragShader) return { isError: true };
		const particleShader = createProgram(particleVertShader, particleFragShader, "particle");
		if (!particleShader) return { isError: true };

		const inPositionLoc = gl.getAttribLocation(particleShader, "inPosition")!;
		const uNoiseOffsetLoc = gl.getUniformLocation(particleShader, "uNoiseOffset")!;
		const uAmplitudeLoc = gl.getUniformLocation(particleShader, "uAmplitude")!;
		const uSeedLoc = gl.getUniformLocation(particleShader, "uSeed")!;
		const uDotSpacingLoc = gl.getUniformLocation(particleShader, "uDotSpacing")!;
		const uDotOffsetLoc = gl.getUniformLocation(particleShader, "uDotOffset")!;
		const uSphereRadiusLoc = gl.getUniformLocation(particleShader, "uSphereRadius")!;
		const uFeatherLoc = gl.getUniformLocation(particleShader, "uFeather")!;
		const uNoiseFrequencyLoc = gl.getUniformLocation(particleShader, "uNoiseFrequency")!;
		const uNoiseAmplitudeLoc = gl.getUniformLocation(particleShader, "uNoiseAmplitude")!;

		const dotVertShader = createShader(gl.VERTEX_SHADER, DOT_VERT_SHADER, "dot vertex");
		if (!dotVertShader) return { isError: true };
		const dotFragShader = createShader(gl.FRAGMENT_SHADER, DOT_FRAG_SHADER, "dot fragment");
		if (!dotFragShader) return { isError: true };
		const dotShader = createProgram(dotVertShader, dotFragShader, "dot");
		if (!dotShader) return { isError: true };

		const inPositionLocDot = gl.getAttribLocation(dotShader, "inPosition")!;
		const uDotCountLoc = gl.getUniformLocation(dotShader, "uDotCount")!;
		const uDotRadiusLoc = gl.getUniformLocation(dotShader, "uDotRadius")!;
		const uDotRadiusPXLoc = gl.getUniformLocation(dotShader, "uDotRadiusPX")!;
		const uParticleTextureLoc = gl.getUniformLocation(dotShader, "uParticleTexture")!;

		const blurVertShader = createShader(gl.VERTEX_SHADER, BLUR_VERT_SHADER, "blur vertex");
		if (!blurVertShader) return { isError: true };
		const blurFragShader = createShader(gl.FRAGMENT_SHADER, BLUR_FRAG_SHADER, "blur fragment");
		if (!blurFragShader) return { isError: true };
		const blurShader = createProgram(blurVertShader, blurFragShader, "blur");
		if (!blurShader) return { isError: true };

		const inPositionLocBlur = gl.getAttribLocation(blurShader, "inPosition")!;
		const uBlurRadiusLoc = gl.getUniformLocation(blurShader, "uBlurRadius")!;
		const uBlurDirectionLoc = gl.getUniformLocation(blurShader, "uBlurDirection")!;
		const uBlurInputTextureLoc = gl.getUniformLocation(blurShader, "uInputTexture")!;

		const finalizeVertShader = createShader(gl.VERTEX_SHADER, FINALIZE_VERT_SHADER, "finalize vertex");
		if (!finalizeVertShader) return { isError: true };
		const finalizeFragShader = createShader(gl.FRAGMENT_SHADER, FINALIZE_FRAG_SHADER, "finalize fragment");
		if (!finalizeFragShader) return { isError: true };
		const finalizeShader = createProgram(finalizeVertShader, finalizeFragShader, "finalize");
		if (!finalizeShader) return { isError: true };

		const inPositionLocFinalize = gl.getAttribLocation(finalizeShader, "inPosition")!;
		const uBaseColorLoc = gl.getUniformLocation(finalizeShader, "uBaseColor")!;
		const uSecondaryColorLoc = gl.getUniformLocation(finalizeShader, "uSecondaryColor")!;
		const uAccentColorLoc = gl.getUniformLocation(finalizeShader, "uAccentColor")!;
		const uTimeLoc = gl.getUniformLocation(finalizeShader, "uTime")!;
		const uAmplitudeFinalizeLoc = gl.getUniformLocation(finalizeShader, "uAmplitude")!;
		const uColorCycleSpeedLoc = gl.getUniformLocation(finalizeShader, "uColorCycleSpeed")!;
		const uColorMixIntensityLoc = gl.getUniformLocation(finalizeShader, "uColorMixIntensity")!;
		const uBlurredTextureLoc = gl.getUniformLocation(finalizeShader, "uBlurredTexture")!;
		const uOriginalTextureLoc = gl.getUniformLocation(finalizeShader, "uOriginalTexture")!;

		const { framebuffer: particleFramebuffer, texture: particleTexture } = createFramebuffer(gl.NEAREST);
		const { framebuffer: dotFramebuffer, texture: dotTexture } = createFramebuffer(gl.NEAREST);
		const { framebuffer: blurXFramebuffer, texture: blurXTexture } = createFramebuffer(gl.LINEAR);
		const { framebuffer: blurYFramebuffer, texture: blurYTexture } = createFramebuffer(gl.NEAREST);

		const quadBuffer = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
		// prettier-ignore
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            -1, 1,
            1, 1,
            1, -1
        ]), gl.STATIC_DRAW);

		gl.enable(gl.BLEND);
		gl.blendEquation(gl.MAX);

		return {
			isError: false,
			particleShader,
			dotShader,
			blurShader,
			finalizeShader,
			viewportSize: 0,
			particleTextureSize: 0,

			inPositionLoc,
			inPositionLocDot,
			inPositionLocBlur,
			inPositionLocFinalize,

			uNoiseOffsetLoc,
			uAmplitudeLoc,
			uSeedLoc,
			uDotSpacingLoc,
			uDotOffsetLoc,
			uSphereRadiusLoc,
			uFeatherLoc,
			uNoiseFrequencyLoc,
			uNoiseAmplitudeLoc,

			uDotCountLoc,
			uDotRadiusLoc,
			uDotRadiusPXLoc,
			uParticleTextureLoc,

			uBlurRadiusLoc,
			uBlurDirectionLoc,
			uBlurInputTextureLoc,

			uBaseColorLoc,
			uSecondaryColorLoc,
			uAccentColorLoc,
			uTimeLoc,
			uAmplitudeFinalizeLoc,
			uColorCycleSpeedLoc,
			uColorMixIntensityLoc,
			uBlurredTextureLoc,
			uOriginalTextureLoc,

			quadBuffer,

			particleFramebuffer,
			particleTexture,
			dotFramebuffer,
			dotTexture,
			blurXFramebuffer,
			blurXTexture,
			blurYFramebuffer,
			blurYTexture
		};
	}, []);

	const onResize = useCallback((gl: WebGL2RenderingContext | null, state: RendererState) => {
		if (state.isError || !gl) return;

		state.viewportSize = Math.min(gl.canvas.width, gl.canvas.height);
		gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

		gl.bindTexture(gl.TEXTURE_2D, state.dotTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, state.viewportSize, state.viewportSize, 0, gl.RED, gl.UNSIGNED_BYTE, null);

		gl.bindTexture(gl.TEXTURE_2D, state.blurXTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, state.viewportSize, state.viewportSize, 0, gl.RED, gl.UNSIGNED_BYTE, null);

		gl.bindTexture(gl.TEXTURE_2D, state.blurYTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, state.viewportSize, state.viewportSize, 0, gl.RED, gl.UNSIGNED_BYTE, null);
	}, []);

	const onRender = useCallback((gl: WebGL2RenderingContext | null, data: CanvasData, state: RendererState) => {
		if (state.isError || !gl) return;

		const progress = Spicetify.Player.getProgress() / 1000;

		const uNoiseOffset = (0.5 * progress + sampleAccumulatedIntegral(data.amplitudeCurve, progress)) * 75 * 0.01;
		const uAmplitude = sampleAmplitudeMovingAverage(data.amplitudeCurve, progress, 0.15);
		const uSeed = data.seed;
		const uDotCount = 322;
		const uDotRadius = 0.9 / uDotCount;
		const uDotRadiusPX = uDotRadius * 0.5 * state.viewportSize;
		const uDotSpacing = 0.9;
		const uDotOffset = -0.9 / 2;
		
		// Enhanced sphere radius with more dynamic range and rhythmic pulsing
		const baseSphereRadius = mapLinear(uAmplitude, 0, 1, 0.6 * 0.9, 1.1 * 0.9);
		const rhythmicPulse = Math.sin(progress * 2.0) * uAmplitude * 0.1;
		const uSphereRadius = baseSphereRadius + rhythmicPulse;
		
		// Enhanced feather with audio responsiveness
		const baseFeather = Math.pow(uAmplitude + 3, 2) * (45 / 1568);
		const uFeather = baseFeather * (1.0 + uAmplitude * 0.5);
		
		// Dynamic noise parameters that respond to audio
		const uNoiseFrequency = 4 + uAmplitude * 2.0; // Higher frequency with louder music
		const uNoiseAmplitude = (0.32 * 0.9) * (1.0 + uAmplitude * 0.7); // More noise with amplitude

		if (state.particleTextureSize !== uDotCount) {
			state.particleTextureSize = uDotCount;

			gl.bindTexture(gl.TEXTURE_2D, state.particleTexture);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, uDotCount, uDotCount, 0, gl.RG, gl.FLOAT, null);
		}

		// calculate particle positions
		gl.disable(gl.BLEND);
		gl.bindFramebuffer(gl.FRAMEBUFFER, state.particleFramebuffer);
		gl.viewport(0, 0, uDotCount, uDotCount);

		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.useProgram(state.particleShader);
		gl.uniform1f(state.uNoiseOffsetLoc, uNoiseOffset);
		gl.uniform1f(state.uAmplitudeLoc, uAmplitude);
		gl.uniform1i(state.uSeedLoc, uSeed);
		gl.uniform1f(state.uDotSpacingLoc, uDotSpacing);
		gl.uniform1f(state.uDotOffsetLoc, uDotOffset);
		gl.uniform1f(state.uSphereRadiusLoc, uSphereRadius);
		gl.uniform1f(state.uFeatherLoc, uFeather);
		gl.uniform1f(state.uNoiseFrequencyLoc, uNoiseFrequency);
		gl.uniform1f(state.uNoiseAmplitudeLoc, uNoiseAmplitude);

		gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
		gl.enableVertexAttribArray(state.inPositionLoc);
		gl.vertexAttribPointer(state.inPositionLoc, 2, gl.FLOAT, false, 0, 0);
		gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

		// render dots
		gl.enable(gl.BLEND);
		gl.bindFramebuffer(gl.FRAMEBUFFER, state.dotFramebuffer);
		gl.viewport(0, 0, state.viewportSize, state.viewportSize);

		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.useProgram(state.dotShader);
		gl.uniform1i(state.uDotCountLoc, uDotCount);
		gl.uniform1f(state.uDotRadiusLoc, uDotRadius);
		gl.uniform1f(state.uDotRadiusPXLoc, uDotRadiusPX);
		gl.uniform1i(state.uParticleTextureLoc, 0);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, state.particleTexture);

		gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
		gl.enableVertexAttribArray(state.inPositionLocDot);
		gl.vertexAttribPointer(state.inPositionLocDot, 2, gl.FLOAT, false, 0, 0);

		gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, uDotCount * uDotCount);

		// blur in X direction
		gl.bindFramebuffer(gl.FRAMEBUFFER, state.blurXFramebuffer);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.useProgram(state.blurShader);
		gl.uniform1f(state.uBlurRadiusLoc, 0.01 * state.viewportSize);
		gl.uniform2f(state.uBlurDirectionLoc, 1 / state.viewportSize, 0);
		gl.uniform1i(state.uBlurInputTextureLoc, 0);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, state.dotTexture);

		gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
		gl.enableVertexAttribArray(state.inPositionLocBlur);
		gl.vertexAttribPointer(state.inPositionLocBlur, 2, gl.FLOAT, false, 0, 0);
		gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

		// blur in Y direction
		gl.bindFramebuffer(gl.FRAMEBUFFER, state.blurYFramebuffer);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.uniform2f(state.uBlurDirectionLoc, 0, 1 / state.viewportSize);
		gl.bindTexture(gl.TEXTURE_2D, state.blurXTexture);
		gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		// combine blurred and original with dynamic colors
		gl.useProgram(state.finalizeShader);
		
		// Generate color palette from theme color
		const colorPalette = generateColorPalette(data.themeColor);
		
		// Set dynamic color uniforms
		gl.uniform3f(
			state.uBaseColorLoc,
			colorPalette.base[0] / 255,
			colorPalette.base[1] / 255,
			colorPalette.base[2] / 255
		);
		gl.uniform3f(
			state.uSecondaryColorLoc,
			colorPalette.secondary[0] / 255,
			colorPalette.secondary[1] / 255,
			colorPalette.secondary[2] / 255
		);
		gl.uniform3f(
			state.uAccentColorLoc,
			colorPalette.accent[0] / 255,
			colorPalette.accent[1] / 255,
			colorPalette.accent[2] / 255
		);
		
		// Set time and animation uniforms with audio responsiveness
		gl.uniform1f(state.uTimeLoc, progress);
		gl.uniform1f(state.uAmplitudeFinalizeLoc, uAmplitude);
		
		// Dynamic color cycling that responds to audio
		const baseColorSpeed = 0.3; // Base cycling speed
		const audioResponsiveSpeed = baseColorSpeed * (1.0 + uAmplitude * 1.5);
		gl.uniform1f(state.uColorCycleSpeedLoc, audioResponsiveSpeed);
		
		// Dynamic color mixing intensity based on amplitude
		const baseMixIntensity = 1.5;
		const dynamicMixIntensity = baseMixIntensity * (1.0 + uAmplitude * 2.0);
		gl.uniform1f(state.uColorMixIntensityLoc, dynamicMixIntensity);
		
		gl.uniform1i(state.uBlurredTextureLoc, 0);
		gl.uniform1i(state.uOriginalTextureLoc, 1);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, state.blurYTexture);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, state.dotTexture);

		gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
		gl.enableVertexAttribArray(state.inPositionLocFinalize);
		gl.vertexAttribPointer(state.inPositionLocFinalize, 2, gl.FLOAT, false, 0, 0);
		gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
	}, []);

	return (
		<AnimatedCanvas
			isEnabled={props.isEnabled}
			data={{ themeColor: props.themeColor, seed, amplitudeCurve }}
			contextType="webgl2"
			onInit={onInit}
			onResize={onResize}
			onRender={onRender}
			style={{
				width: "100%",
				height: "100%",
				objectFit: "contain"
			}}
			sizeConstraint={(width, height) => {
				const size = Math.min(width, height);
				return { width: size, height: size };
			}}
		/>
	);
}
