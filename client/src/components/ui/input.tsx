import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onWheel, ...props }, ref) => {
    // h-9 to match icon buttons and default buttons.
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        onWheel={
          type === "number"
            ? (e) => {
                // Chrome/Firefox change a focused number input's value on
                // mouse-wheel scroll. Blur it first so scrolling the page
                // over an input never silently edits a saved number.
                e.currentTarget.blur();
                onWheel?.(e);
              }
            : onWheel
        }
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
