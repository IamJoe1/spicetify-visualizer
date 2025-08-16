import React, { useCallback, useContext } from "react";
import AnimatedCanvas from "../AnimatedCanvas";
import { ErrorHandlerContext } from "../../error";
import { RendererProps } from "../../app";

type CanvasData = {
	themeColor: Spicetify.Color;
};

type RendererState = {
	isError: boolean;
	time: number;
};

export default function TestVisualizer(props: RendererProps) {
	const onError = useContext(ErrorHandlerContext);

	const onInit = useCallback((ctx: CanvasRenderingContext2D | null, state: RendererState) => {
		console.log("TestVisualizer: onInit called");
		if (!ctx) {
			console.error("TestVisualizer: No canvas context");
			return { isError: true, time: 0 };
		}
		console.log("TestVisualizer: Init successful");
		return { isError: false, time: 0 };
	}, []);

	const onResize = useCallback((ctx: CanvasRenderingContext2D | null, state: RendererState) => {
		console.log("TestVisualizer: onResize called");
		if (state.isError || !ctx) return state;
		return state;
	}, []);

	const onRender = useCallback((ctx: CanvasRenderingContext2D | null, data: CanvasData, state: RendererState) => {
		if (state.isError || !ctx) return state;

		// Simple animated background
		const newTime = state.time + 0.016;
		
		// Clear with animated color
		const hue = (newTime * 50) % 360;
		ctx.fillStyle = `hsl(${hue}, 50%, 20%)`;
		ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

		// Draw a simple pulsing circle
		const centerX = ctx.canvas.width / 2;
		const centerY = ctx.canvas.height / 2;
		const radius = 50 + Math.sin(newTime * 2) * 20;

		// Use theme color for the circle
		ctx.fillStyle = data.themeColor.toCSS(Spicetify.Color.CSSFormat.HEX);
		ctx.beginPath();
		ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
		ctx.fill();

		// Draw some text
		ctx.fillStyle = "white";
		ctx.font = "20px Arial";
		ctx.textAlign = "center";
		ctx.fillText("Test Visualizer Working!", centerX, centerY - 100);
		ctx.fillText(`Time: ${newTime.toFixed(1)}s`, centerX, centerY + 100);

		return { ...state, time: newTime };
	}, []);

	console.log("TestVisualizer: Component rendering");

	return (
		<AnimatedCanvas
			isEnabled={props.isEnabled}
			data={{ themeColor: props.themeColor }}
			contextType="2d"
			onInit={onInit}
			onResize={onResize}
			onRender={onRender}
			style={{
				width: "100%",
				height: "100%",
				background: "#000"
			}}
		/>
	);
}
