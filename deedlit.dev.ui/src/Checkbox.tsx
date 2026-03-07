import { type ComponentPropsWithoutRef, forwardRef } from "react"
import { cn } from "./utils";
export type CheckboxProps = ComponentPropsWithoutRef<"input"> & {
	label?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(props, ref) {
	const { label, id, className, disabled, ...rest } = props;
	return (
		<label
			className={cn(
				"group/cb inline-flex cursor-pointer items-center gap-2 select-none",
				disabled && "pointer-events-none opacity-50",
				className
			)}
		>
			<input
				{...rest}
				ref={ref}
				id={id}
				type="checkbox"
				disabled={disabled}
				className={cn("peer sr-only border-0")}
			/>
			<span
				className={cn(
					"grid h-[1.2rem] w-[1.2rem] shrink-0 place-items-center rounded",
					"border border-[--ui-border-muted] bg-[color-mix(in_oklab,var(--surface-0)_92%,transparent)]",
					"transition-all duration-180 ease-in-out",
					"group-hover/cb:border-[--panel-border]",
					"peer-focus-visible:border-[--panel-border-muted] peer-focus-visible:shadow-[0_0_0_2px_color-mix(in_oklab,var(--accent-cyan)_22%,transparent)]",
					"peer-checked:border-[--panel-border-muted] peer-checked:bg-[linear-gradient(135deg,color-mix(in_oklab,var(--accent-cyan)_24%,var(--surface-1))_0%,color-mix(in_oklab,var(--accent-pink)_22%,var(--surface-1))_100%)]"
				)}
				aria-hidden="true"
			>
				<svg
					className="h-3 w-3 opacity-0 transition-opacity duration-180 ease-in-out peer-checked:group-[]/cb:opacity-100 [input:checked~span>&]:opacity-100"
					viewBox="0 0 12 12"
					fill="none"
					stroke="var(--text-0)"
					strokeWidth={2}
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M2.5 6.5L5 9l4.5-6" />
				</svg>
			</span>
			{label && (
				<span className="text-ui-sm text-[--ui-ink] transition-colors duration-[180ms] ease-in-out group-hover/cb:text-[--ui-ink-hover]">
					{label}
				</span>
			)}
		</label>
	)
})

Checkbox.displayName = "Checkbox"
export default Checkbox
