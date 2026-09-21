import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Search, Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useDropdownPosition } from '../../hooks/useDropdownPosition';

export interface Option {
    value: string;
    label: string | React.ReactNode;
}

interface CustomSelectProps {
    value: string;
    onChange: (value: string) => void;
    options: Option[];
    placeholder?: string;
    disabled?: boolean;
    className?: string; // Optional class for the trigger button
    loading?: boolean;  // Display a loading spinner
    searchable?: boolean; // Force show/hide search input. If undefined, shows if options.length > 5
    ariaLabel?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
    value,
    onChange,
    options,
    placeholder = "Seleccionar...",
    disabled = false,
    className = "",
    loading = false,
    searchable,
    ariaLabel
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const { triggerRef, menuStyles } = useDropdownPosition(isOpen, { align: 'left' });
    const menuRef = useRef<HTMLDivElement>(null);

    // Dynamic width alignment with trigger
    const [dynamicStyles, setDynamicStyles] = useState<React.CSSProperties>({});

    useEffect(() => {
        if (isOpen && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setDynamicStyles({
                ...menuStyles,
                minWidth: Math.max(rect.width, 160),
                width: rect.width
            });
        }
    }, [menuStyles, isOpen]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (
                triggerRef.current && !triggerRef.current.contains(target) &&
                menuRef.current && !menuRef.current.contains(target)
            ) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const selectedOption = options.find(o => String(o.value) === String(value));
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        if (!isOpen) {
            setSearchQuery("");
        }
    }, [isOpen]);

    const getOptionText = (label: React.ReactNode): string => {
        if (typeof label === 'string' || typeof label === 'number') {
            return String(label);
        }
        try {
            if (React.isValidElement(label)) {
                const extractText = (node: any): string => {
                    if (!node) return '';
                    if (typeof node === 'string' || typeof node === 'number') return String(node);
                    if (Array.isArray(node)) return node.map(extractText).join(' ');
                    if (node.props && node.props.children) return extractText(node.props.children);
                    return '';
                };
                return extractText(label);
            }
        } catch (e) {
            console.error(e);
        }
        return '';
    };

    const isSearchable = searchable !== undefined ? searchable : options.length > 5;

    const filteredOptions = options.filter(option => {
        if (!isSearchable || !searchQuery.trim()) return true;
        const text = getOptionText(option.label).toLowerCase();
        return text.includes(searchQuery.toLowerCase());
    });

    const dropdownContent = isOpen && !disabled && (
        <div 
            ref={menuRef}
            /* El menú va al final de `body`, así que su z-index compite con el de los
               modales de la aplicación, que llegan hasta 2147483646. Con un valor menor
               el desplegable se abre pero queda pintado por debajo del diálogo que lo
               contiene y parece que no pasa nada. Un menú anclado a su disparador
               siempre debe quedar encima de lo que lo abrió: tope de la pila. */
            className="bg-white border border-slate-200 rounded-2xl shadow-xl z-[2147483647] py-1 flex flex-col fixed overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100"
            style={dynamicStyles}
        >
            {isSearchable && (
                <div className="px-2.5 py-1.5 border-b border-slate-100 shrink-0">
                    <div className="relative flex items-center">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Buscar..."
                            className="w-full pl-8 pr-2.5 py-1 text-xs border border-slate-200 rounded-lg focus:border-teal-500 focus:ring-2 focus:ring-teal-100 focus:outline-none bg-slate-50 text-slate-800 font-semibold"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                        />
                    </div>
                </div>
            )}
            <div className="max-h-56 overflow-y-auto p-1 space-y-0.5 custom-scrollbar">
                {filteredOptions.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-slate-400 italic text-center">Sin resultados</div>
                ) : (
                    filteredOptions.map(option => {
                        const isSelected = String(option.value) === String(value);
                        return (
                            <button
                                key={String(option.value)}
                                type="button"
                                onClick={() => {
                                    onChange(option.value);
                                    setIsOpen(false);
                                }}
                                className={`flex items-center justify-between w-full text-left px-3 py-2 text-xs rounded-xl transition-all ${
                                    isSelected 
                                        ? 'bg-teal-50 text-teal-800 font-bold border border-teal-100/60' 
                                        : 'text-slate-700 hover:bg-slate-50 hover:text-teal-700 font-medium'
                                }`}
                            >
                                <span className="truncate">{option.label}</span>
                                {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-teal-600 ml-1.5" />}
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );

    return (
        <div className="relative w-full" ref={triggerRef}>
            <button
                type="button"
                disabled={disabled}
                aria-label={ariaLabel}
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full flex items-center justify-between border rounded-xl px-3 py-2 text-xs font-bold outline-none transition-all shadow-2xs ${
                    disabled 
                        ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' 
                        : isOpen 
                            ? 'bg-white border-teal-500 ring-4 ring-teal-100 text-slate-900' 
                            : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50/50'
                } ${className}`}
            >
                <span className="truncate mr-2 font-bold text-left">
                    {selectedOption ? selectedOption.label : <span className="text-slate-400 font-normal">{placeholder}</span>}
                </span>
                {loading ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-teal-600" />
                ) : (
                    <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180 text-teal-600' : 'text-slate-400'}`} />
                )}
            </button>
            {createPortal(dropdownContent, document.body)}
        </div>
    );
};
