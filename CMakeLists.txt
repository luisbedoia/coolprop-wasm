cmake_minimum_required(VERSION 3.12)

project(coolprop-ts LANGUAGES C CXX)

# ─── Build options ────────────────────────────────────────────────────────────
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

add_compile_options(-Os -flto)

# ─── Output locations ─────────────────────────────────────────────────────────
set(TS_OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/coolprop.d.ts")
set(TSD_FLAG "--emit-tsd=${TS_OUTPUT}")

# ─── Emscripten flags ─────────────────────────────────────────────────────────
set(EM_FLAGS
  --bind
  ${TSD_FLAG}
  -s MODULARIZE=1
  -s EXPORT_ES6=1
  -s EXPORT_NAME=MainModuleFactory
  -s ENVIRONMENT=web,node
  -s ALLOW_MEMORY_GROWTH=1
  -s ASSERTIONS=0
  -s DISABLE_EXCEPTION_CATCHING=0
)

add_definitions(-DCOOLPROP_NO_INCBIN)

# ─── Paths ────────────────────────────────────────────────────────────────────
set(COOLPROP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/coolprop")

if(NOT DEFINED COOLPROP_INSTALL_PREFIX)
  set(COOLPROP_INSTALL_PREFIX "${CMAKE_CURRENT_SOURCE_DIR}/wasm")
endif()

set(CMAKE_INSTALL_PREFIX "${COOLPROP_INSTALL_PREFIX}" CACHE PATH "Install path" FORCE)

# ─── Boost headers (needed by teqp backend) ───────────────────────────────────
set(BOOST_ARCHIVE "${COOLPROP_DIR}/dev/docker/boost_bcp_docker/boost_CoolProp.tar.xz")
set(BOOST_VERSION_HPP "${COOLPROP_DIR}/boost_CoolProp/boost/version.hpp")

if(NOT EXISTS "${BOOST_VERSION_HPP}")
  if(EXISTS "${BOOST_ARCHIVE}")
    execute_process(
      COMMAND ${CMAKE_COMMAND} -E tar -xJf "${BOOST_ARCHIVE}"
      WORKING_DIRECTORY "${COOLPROP_DIR}"
    )
    message(STATUS "Extracted Boost headers for CoolProp.")
  else()
    message(FATAL_ERROR "Boost archive not found: ${BOOST_ARCHIVE}")
  endif()
endif()

# ─── Include directories ──────────────────────────────────────────────────────
set(APP_INCLUDE_DIRS
  "${COOLPROP_DIR}"
  "${COOLPROP_DIR}/include"
  "${COOLPROP_DIR}/src"
  "${COOLPROP_DIR}/externals/Eigen"
  "${COOLPROP_DIR}/externals/msgpack-c/include"
  "${COOLPROP_DIR}/externals/miniz-3.0.2"
  "${COOLPROP_DIR}/externals/incbin"
  "${COOLPROP_DIR}/externals/fmtlib/include"
  "${COOLPROP_DIR}/boost_CoolProp"
  "${COOLPROP_DIR}/dev"
)
include_directories(${APP_INCLUDE_DIRS})

# ─── Sources ──────────────────────────────────────────────────────────────────
set(COOLPROP_ENABLED_BACKENDS
  Cubics IF97 Helmholtz REFPROP Incompressible Tabular PCSAFT
)

file(GLOB APP_SOURCES "${COOLPROP_DIR}/src/*.cpp")
list(APPEND APP_SOURCES "${COOLPROP_DIR}/externals/miniz-3.0.2/miniz.c")

foreach(backend IN LISTS COOLPROP_ENABLED_BACKENDS)
  file(GLOB_RECURSE BACKEND_SRC "${COOLPROP_DIR}/src/Backends/${backend}/*.cpp")
  list(APPEND APP_SOURCES ${BACKEND_SRC})
endforeach()

list(REMOVE_ITEM APP_SOURCES
  "${COOLPROP_DIR}/src/Tests/Tests.cpp"
  "${COOLPROP_DIR}/src/Tests/CoolProp-Tests.cpp"
)

list(APPEND APP_SOURCES
  "${COOLPROP_DIR}/src/CoolPropLib.cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/bindings/wrapper.cpp"
)

# ─── Generate fluid & mixture headers ─────────────────────────────────────────
find_package(Python COMPONENTS Interpreter QUIET)

if(Python_Interpreter_FOUND)
  add_custom_target(generate_headers
    COMMAND "${Python_EXECUTABLE}" "${COOLPROP_DIR}/dev/generate_headers.py"
    WORKING_DIRECTORY "${COOLPROP_DIR}/dev"
    COMMENT "Generating CoolProp fluid and mixture headers"
  )
else()
  message(WARNING "Python not found – skipping header regeneration")
  add_custom_target(generate_headers)
endif()

# ─── Target definition ────────────────────────────────────────────────────────
add_executable(coolprop ${APP_SOURCES})
add_dependencies(coolprop generate_headers)

set_target_properties(coolprop PROPERTIES
  PREFIX ""
  SUFFIX ".js"
)

string(JOIN " " EM_FLAGS_STR ${EM_FLAGS})
set_property(TARGET coolprop APPEND_STRING PROPERTY LINK_FLAGS " ${EM_FLAGS_STR}")

target_include_directories(coolprop PUBLIC ${APP_INCLUDE_DIRS})

# ─── Install ─────────────────────────────────────────────────────────────────
install(
  FILES
    "${CMAKE_CURRENT_BINARY_DIR}/coolprop.js"
    "${CMAKE_CURRENT_BINARY_DIR}/coolprop.wasm"
    "${TS_OUTPUT}"
  DESTINATION "${CMAKE_INSTALL_PREFIX}"
)
