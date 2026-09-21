import React, { useState, useEffect, useMemo } from 'react';
import { Filter, ChevronRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useDropdownPosition } from '../hooks/useDropdownPosition';
import { CustomSelect } from './ui/CustomSelect';

export type NumberFilterCondition = 'EQUALS' | 'NOT_EQUALS' | 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL' | 'LESS_THAN' | 'LESS_THAN_OR_EQUAL' | 'BETWEEN' | 'NONE';

export interface NumberFilterState {
    type: 'list' | 'condition';
    listValues: string[];
    condition: NumberFilterCondition;
    value1: string;
    value2: string;
}

export const defaultNumberFilterState: NumberFilterState = {
    type: 'list',
    listValues: [],
    condition: 'NONE',
    value1: '',
    value2: ''
};

export const NumberFilter = ({
    title,
    options,
    filterState,
    onChange,
    portalTarget
}: {
    title: string;
    options: { value: string; label: string }[];
    filterState: NumberFilterState | null;
    onChange: (state: NumberFilterState | null) => void;
    portalTarget?: HTMLElement | null;
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [showConditionMenu, setShowConditionMenu] = useState(false);
    const [tempState, setTempState] = useState<NumberFilterState>(filterState || defaultNumberFilterState);
    const [searchTerm, setSearchTerm] = useState('');
    const dropdownRef = React.useRef<HTMLDivElement>(null);
    
    // Using the new hook
    const { triggerRef, menuStyles } = useDropdownPosition(isOpen);

    useEffect(() => {
        if (isOpen) {
            setTempState(filterState || defaultNumberFilterState);
            setSearchTerm('');
            setShowConditionMenu(false);
        }
    }, [isOpen, filterState]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
                triggerRef.current && !triggerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const filteredOptions = options.filter(o => o.label.toLowerCase().includes(searchTerm.toLowerCase()));
    const allSelected = filteredOptions.length > 0 && filteredOptions.every(o => tempState.listValues.includes(o.value));

    const toggleSelectAll = () => {
        if (allSelected) {
            setTempState(prev => ({ ...prev, type: 'list', listValues: prev.listValues.filter(v => !filteredOptions.some(o => o.value === v)) }));
        } else {
            setTempState(prev => ({ ...prev, type: 'list', listValues: Array.from(new Set([...prev.listValues, ...filteredOptions.map(o => o.value)])) }));
        }
    };

    const toggleOption = (value: string) => {
        setTempState(prev => ({
            ...prev,
            type: 'list',
            listValues: prev.listValues.includes(value) ? prev.listValues.filter(v => v !== value) : [...prev.listValues, value]
        }));
    };

    const handleAccept = () => {
        if (tempState.type === 'list' && tempState.listValues.length === 0) {
            onChange(null);
        } else if (tempState.type === 'condition' && tempState.condition === 'NONE') {
            onChange(null);
        } else {
            onChange(tempState);
        }
        setIsOpen(false);
    };

    const handleCancel = () => {
        setIsOpen(false);
    };

    const handleClear = () => {
        onChange(null);
        setIsOpen(false);
    };

    const isFilterActive = useMemo(() => {
        if (!filterState) return false;
        if (filterState.type === 'list') {
            if (filterState.listValues.length === 0) return false;
            if (options.length === 0) return false;
            if (filterState.listValues.length !== options.length) return true;
            return !options.every(o => filterState.listValues.includes(o.value));
        } else {
            return filterState.condition !== 'NONE';
        }
    }, [filterState, options]);

    const setCondition = (cond: NumberFilterCondition) => {
        setTempState(prev => ({
            ...prev,
            type: 'condition',
            condition: cond
        }));
    };

    return (
        <div className="relative inline-flex items-center justify-center w-full h-full" ref={triggerRef}>
            <div
                className="flex items-center justify-center gap-1 cursor-pointer w-full h-full hover:bg-slate-100 transition-colors p-2"
                onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
            >
                <span>{title}</span>
                <Filter className={`h-3 w-3 ${isFilterActive ? 'text-indigo-600 fill-indigo-600' : 'text-slate-300'}`} />
            </div>

            {isOpen && createPortal(
                <div
                    ref={dropdownRef}
                    className="fixed min-w-[240px] bg-white border border-slate-200 shadow-xl rounded-xl z-[120000] p-2 font-normal text-left text-xs text-slate-700 animate-in fade-in zoom-in-95 duration-200 flex flex-col gap-2"
                    style={{ ...menuStyles, visibility: Object.keys(menuStyles).length === 0 ? 'hidden' : 'visible' }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header actions */}
                    <div className="flex items-center justify-between px-2 py-1 border-b border-slate-100 pb-2">
                        <span className="font-bold text-slate-800">Filtro de {title}</span>
                        <button onClick={handleClear} className="text-slate-400 hover:text-red-500 transition-colors text-[10px] uppercase font-bold tracking-wider">
                            Borrar
                        </button>
                    </div>

                    {/* Condition Menu Toggle */}
                    <div 
                        className="flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors group"
                        onClick={() => setShowConditionMenu(!showConditionMenu)}
                    >
                        <span className="font-medium text-slate-700 group-hover:text-indigo-600">Filtros de número</span>
                        <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${showConditionMenu ? 'rotate-90' : ''}`} />
                    </div>

                    {/* Condition Builder */}
                    {showConditionMenu && (
                        <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 space-y-2 mb-2">
                            <CustomSelect
                                className="w-full bg-white text-xs border border-slate-300 rounded-lg"
                                value={tempState.condition}
                                onChange={(val) => setCondition(val as NumberFilterCondition)}
                                options={[
                                    { value: 'NONE', label: 'Ninguno' },
                                    { value: 'EQUALS', label: 'Es igual a...' },
                                    { value: 'NOT_EQUALS', label: 'No es igual a...' },
                                    { value: 'GREATER_THAN', label: 'Mayor que...' },
                                    { value: 'GREATER_THAN_OR_EQUAL', label: 'Mayor o igual que...' },
                                    { value: 'LESS_THAN', label: 'Menor que...' },
                                    { value: 'LESS_THAN_OR_EQUAL', label: 'Menor o igual que...' },
                                    { value: 'BETWEEN', label: 'Entre...' }
                                ]}
                            />

                            {tempState.condition !== 'NONE' && (
                                <div className="space-y-2 mt-2">
                                    <input
                                        type="number"
                                        placeholder="Valor"
                                        className="w-full p-2 border border-slate-300 rounded-lg text-xs"
                                        value={tempState.value1}
                                        onChange={(e) => setTempState(prev => ({ ...prev, type: 'condition', value1: e.target.value }))}
                                    />
                                    {tempState.condition === 'BETWEEN' && (
                                        <>
                                            <div className="text-center text-slate-500 font-medium">Y</div>
                                            <input
                                                type="number"
                                                placeholder="Valor 2"
                                                className="w-full p-2 border border-slate-300 rounded-lg text-xs"
                                                value={tempState.value2}
                                                onChange={(e) => setTempState(prev => ({ ...prev, type: 'condition', value2: e.target.value }))}
                                            />
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* List Filter */}
                    {!showConditionMenu && (
                        <>
                            <input
                                type="text"
                                placeholder="Buscar..."
                                className="w-full p-2 border border-slate-300 rounded-lg text-xs"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                            <div
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors ${allSelected && tempState.type === 'list' ? 'font-bold text-indigo-700 bg-indigo-50/50' : ''}`}
                                onClick={toggleSelectAll}
                            >
                                <input
                                    type="checkbox"
                                    checked={allSelected && tempState.type === 'list'}
                                    onChange={() => { }}
                                    className="rounded border border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span>(Seleccionar todo)</span>
                            </div>
                            <div className="max-h-[200px] overflow-y-auto flex flex-col gap-1 pr-1 custom-scrollbar">
                                {filteredOptions.map((option) => {
                                    const isSelected = tempState.type === 'list' && tempState.listValues.includes(option.value);
                                    return (
                                        <div
                                            key={option.value}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors ${isSelected ? 'font-medium text-slate-900 bg-slate-50' : 'text-slate-600'}`}
                                            onClick={() => toggleOption(option.value)}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => { }}
                                                className="rounded border border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                            />
                                            <span className="truncate">{option.label}</span>
                                        </div>
                                    );
                                })}
                                {filteredOptions.length === 0 && (
                                    <div className="text-center py-4 text-slate-400 italic">
                                        No hay resultados
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {/* Footer actions */}
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 mt-1">
                        <button
                            onClick={handleCancel}
                            className="px-3 py-1.5 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors font-medium"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleAccept}
                            className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium shadow-sm"
                        >
                            Aceptar
                        </button>
                    </div>
                </div>
            , portalTarget || document.body)}
        </div>
    );
};
